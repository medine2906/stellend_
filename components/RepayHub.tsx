"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet-context";
import { MIN_DEPOSIT_TRY } from "@/lib/assets";
import { loanTiming } from "@/lib/liquidity";
import type { LoanStatus } from "@/lib/database.types";
import { TxLinks, type TxRecord } from "./TxLinks";

interface Loan {
  id: string;
  collateral_asset: string;
  collateral_amount: number;
  borrowed_usdc_amount: number;
  try_amount: number;
  status: LoanStatus;
  created_at: string;
  due_at: string | null;
}

const TERMINAL_STATUSES = new Set(["completed", "error", "expired", "refunded"]);
const tryFmt = (v: number) => `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} TRY`;
const dateFmt = (v: string) => new Date(v).toLocaleDateString();

/**
 * One place to repay every open cash advance. The Blend debt is per wallet, so a
 * single TRY -> USDC conversion and a single repay transaction cover all selected loans.
 */
export function RepayHub() {
  const { authenticated, signTransaction } = useWallet();
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [owedTry, setOwedTry] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [reload, setReload] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    fetch("/api/profile", { signal: controller.signal }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const open = (data.loans as Loan[]).filter((l) => l.status === "active" || l.status === "defaulted");
      setLoans(open.sort((a, b) => +new Date(a.due_at ?? a.created_at) - +new Date(b.due_at ?? b.created_at)));
      setOwedTry(data.summary.owedTry ?? null);
      setSelected(new Set(open.map((l) => l.id)));
      setLoadError(null);
    }).catch((err) => { if (!controller.signal.aborted) setLoadError(err instanceof Error ? err.message : "Failed to load loans"); });
    return () => controller.abort();
  }, [authenticated, reload]);

  // The Blend debt is per wallet and is the source of truth. Loan rows can stay "active" in the database
  // after their debt is gone on-chain, so only loans the live debt still covers are shown (newest first).
  // Debt above the principal sum is interest, shared proportionally; below it, it is allocated newest-first.
  const { debtLoans, owed } = useMemo(() => {
    const map = new Map<string, number>();
    const all = loans ?? [];
    if (owedTry == null) {
      for (const l of all) map.set(l.id, l.try_amount);
      return { debtLoans: all, owed: map };
    }
    const principal = all.reduce((s, l) => s + l.try_amount, 0);
    if (owedTry >= principal) {
      for (const l of all) map.set(l.id, principal > 0 ? (owedTry * l.try_amount) / principal : 0);
      return { debtLoans: all, owed: map };
    }
    let remaining = owedTry;
    for (const l of [...all].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))) {
      if (remaining < 0.005) break;
      const share = Math.min(l.try_amount, remaining);
      map.set(l.id, share);
      remaining -= share;
    }
    return { debtLoans: all.filter((l) => map.has(l.id)), owed: map };
  }, [loans, owedTry]);

  const chosen = debtLoans.filter((l) => selected.has(l.id));
  const total = Math.ceil(chosen.reduce((s, l) => s + (owed.get(l.id) ?? 0), 0) * 100) / 100;
  const belowMin = total < MIN_DEPOSIT_TRY;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Request to ${url} failed`);
    return data;
  }

  async function submitTx(label: string, url: string, body: unknown) {
    const { hash } = await postJson<{ hash: string }>(url, body);
    setTxs((prev) => [...prev, { label, hash }]);
  }

  async function prepareWithRestore<T>(url: string, body: unknown): Promise<T> {
    const res = await postJson<T & { needsRestore?: boolean; restoreXdr?: string }>(url, body);
    if (res.needsRestore && res.restoreXdr) {
      const signedRestoreXdr = await signTransaction(res.restoreXdr);
      await submitTx("Restore expired data", "/api/loans/restore/submit", { signedXdr: signedRestoreXdr });
      return postJson<T>(url, body);
    }
    return res;
  }

  function waitForDeposit(loanId: string, anchorRef: string): Promise<number> {
    return new Promise((resolve, reject) => {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/loans/${loanId}/repay/deposit/status?anchorRef=${anchorRef}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Failed to poll repayment deposit");
          if (data.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            resolve(data.usdcAmount);
          } else if (TERMINAL_STATUSES.has(data.status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            reject(new Error(`Repayment transfer ${data.status}`));
          }
        } catch (err) {
          if (pollRef.current) clearInterval(pollRef.current);
          reject(err);
        }
      }, 4000);
    });
  }

  async function repaySelected() {
    if (chosen.length === 0) return;
    const [first, ...rest] = chosen;
    setBusy(true);
    setError(null);
    setTxs([]);
    try {
      setMessage("Send TRY to your bank...");
      const { anchorRef } = await postJson<{ anchorRef: string }>(`/api/loans/${first.id}/repay/deposit`, { tryAmount: total });

      setMessage("Waiting for TRY transfer to convert to USDC...");
      const usdcAmount = await waitForDeposit(first.id, anchorRef);

      setMessage(`Repaying ${chosen.length} loan${chosen.length > 1 ? "s" : ""}...`);
      const { unsignedXdr } = await prepareWithRestore<{ unsignedXdr: string }>(`/api/loans/${first.id}/repay/prepare`, { usdcAmount });
      const signedXdr = await signTransaction(unsignedXdr);
      // The server reads the remaining debt from the pool; releasing collateral against a
      // debt that is still open would only fail at signing time.
      const { hash, fullyRepaid } = await postJson<{ hash: string; fullyRepaid: boolean }>(
        `/api/loans/${first.id}/repay/submit`,
        { signedXdr, settledLoanIds: rest.map((l) => l.id) },
      );
      setTxs((prev) => [...prev, { label: "Repay loans", hash }]);

      if (fullyRepaid) {
        for (const loan of chosen) {
          setMessage(`Releasing collateral (${loan.collateral_amount} ${loan.collateral_asset.length > 12 ? `${loan.collateral_asset.slice(0, 6)}...` : loan.collateral_asset})...`);
          const { unsignedXdr: releaseXdr } = await prepareWithRestore<{ unsignedXdr: string }>(`/api/loans/${loan.id}/collateral/withdraw/prepare`, {});
          const signedRelease = await signTransaction(releaseXdr);
          await submitTx("Release collateral", `/api/loans/${loan.id}/collateral/withdraw/submit`, { signedXdr: signedRelease });
        }
        setMessage("Loans repaid and collateral released");
      } else {
        setMessage("Partial repayment applied");
      }
      setReload((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repayment failed");
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) return <div className="card"><p className="text-sm text-muted">Connect and sign in with your wallet to repay.</p></div>;
  if (loadError) return <p className="text-sm text-danger">{loadError}</p>;
  if (!loans) return <p className="text-sm text-muted">Loading your cash advances...</p>;

  const allSelected = chosen.length === debtLoans.length;
  const grandTotal = debtLoans.reduce((s, l) => s + (owed.get(l.id) ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-fg">Repay</h1>
        <p className="mt-1 text-fg-soft">Every open cash advance in one place. Pick the ones you want to pay off together.</p>
      </div>
      {debtLoans.length === 0 ? (
        <div className="card">
          <p className="text-sm text-muted">You have nothing to repay.</p>
          <Link href="/dashboard" className="ui-button ui-button-sm mt-3 inline-block">Back to dashboard</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3 card">
          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-fg-soft">
              <input type="checkbox" checked={allSelected} disabled={busy} onChange={() => setSelected(allSelected ? new Set() : new Set(debtLoans.map((l) => l.id)))} />
              Select all
            </label>
            <span className="text-muted">Total owed {tryFmt(grandTotal)}</span>
          </div>
          <ul className="flex flex-col gap-3">
            {debtLoans.map((loan) => {
              const timing = loanTiming(loan.due_at, new Date());
              return (
                <li key={loan.id} className="inset p-4 text-sm">
                  <label className="flex items-start justify-between gap-3">
                    <span className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1" checked={selected.has(loan.id)} disabled={busy} onChange={() => toggle(loan.id)} />
                      <span>
                        <span className="block font-medium text-fg">{tryFmt(owed.get(loan.id) ?? loan.try_amount)}</span>
                        <span className="block text-xs text-muted">Borrowed {dateFmt(loan.created_at)} · Principal {tryFmt(loan.try_amount)}</span>
                        {loan.due_at && (
                          <span className={`block text-xs ${timing === "current" ? "text-muted" : "text-warn"}`}>
                            {timing === "current" ? "Due" : timing === "overdue" ? "Overdue, was due" : "Past due, was due"} {dateFmt(loan.due_at)}
                          </span>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
            <span className="text-fg-soft">{chosen.length} selected</span>
            <strong className="text-fg">{tryFmt(total)}</strong>
          </div>
          <button onClick={() => void repaySelected()} disabled={busy || chosen.length === 0 || belowMin} className="ui-button ui-button-primary">
            {busy ? "Processing..." : `Repay ${tryFmt(total)}`}
          </button>
          {chosen.length > 0 && belowMin && <p className="text-xs text-warn">Minimum {MIN_DEPOSIT_TRY} TRY. Select more loans to reach it.</p>}
          {message && <p className="text-xs text-muted">{message}</p>}
          {error && <p className="text-xs text-danger">{error}</p>}
          <TxLinks txs={txs} />
        </div>
      )}
    </div>
  );
}
