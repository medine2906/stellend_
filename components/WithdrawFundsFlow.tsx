"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { fetchSandboxAccount } from "@/lib/sandboxAccount";
import { formatIban, normalizeIban } from "@/lib/iban";
import { amountOutOfRange, limitsHint, useAnchorLimits } from "@/lib/useAnchorLimits";
import { TxLinks, type TxRecord } from "./TxLinks";

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

/**
 * Lender: take money back out of the lending pool and cash it out to a bank
 * account in TRY. Only the part of the pool that isn't currently lent out can
 * be withdrawn right now.
 */
export function WithdrawFundsFlow() {
  const { publicKey, authenticated, signTransaction } = useWallet();
  const [tryAmount, setTryAmount] = useState("");
  const [iban, setIban] = useState("");
  // Pay out to the sandbox bank account linked to this wallet, unless the user typed another IBAN.
  useEffect(() => {
    if (!authenticated) return;
    void fetchSandboxAccount().then((acc) => { if (acc) setIban((cur) => cur || acc.iban); }).catch(() => {});
  }, [authenticated, publicKey]);
  const [availableUsdc, setAvailableUsdc] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const limits = useAnchorLimits();
  const amount = Number(tryAmount);
  const normalizedIban = normalizeIban(iban);
  const outOfRange = amountOutOfRange(limits?.withdraw, amount);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const refreshAvailable = useCallback(() => {
    fetch("/api/withdraw-liquidity/prepare")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setAvailableUsdc(data.withdrawableNow);
      })
      .catch(() => setAvailableUsdc(null));
  }, []);

  useEffect(() => {
    if (authenticated) refreshAvailable();
  }, [authenticated, refreshAvailable]);

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Request to ${url} failed`);
    return data;
  }

  async function submitTx(label: string, url: string, body: unknown) {
    const { hash } = await postJson<{ hash: string }>(url, body);
    setTxs((prev) => [...prev, { label, hash }]);
  }

  async function startWithdraw() {
    setBusy(true);
    setError(null);
    setStatus(null);
    setTxs([]);
    try {
      // 1. How much USDC that TRY amount costs right now.
      setMessage("Getting a quote...");
      const { usdcAmount } = await postJson<{ usdcAmount: number }>("/api/loans/quote", { tryAmount: amount });

      // 2. Take the USDC back out of the pool (refused if it's currently lent out).
      setMessage("Taking your money out of the lending pool...");
      let prepared = await postJson<{ unsignedXdr?: string; needsRestore?: boolean; restoreXdr?: string }>(
        "/api/withdraw-liquidity/prepare",
        { usdcAmount },
      );
      if (prepared.needsRestore && prepared.restoreXdr) {
        const signedRestoreXdr = await signTransaction(prepared.restoreXdr);
        await submitTx("Restore expired data", "/api/loans/restore/submit", { signedXdr: signedRestoreXdr });
        prepared = await postJson("/api/withdraw-liquidity/prepare", { usdcAmount });
      }
      if (!prepared.unsignedXdr) throw new Error("Failed to prepare the withdrawal");
      const signedPoolXdr = await signTransaction(prepared.unsignedXdr);
      await submitTx("Withdraw from pool", "/api/withdraw-liquidity/submit", { signedXdr: signedPoolXdr });

      // 3. Cash out to the bank: start the TRY payout, then send the USDC to the anchor.
      setMessage("Sending TRY to your bank...");
      const { withdrawal } = await postJson<{ withdrawal: { id: string; status: string } }>("/api/withdraw", {
        tryAmount: amount,
        iban: normalizedIban,
      });
      // Destination and amount come from the withdrawal the anchor issued, held server-side.
      const { unsignedXdr: payoutXdr } = await postJson<{ unsignedXdr: string }>("/api/loans/borrow/payout/prepare", {
        withdrawalId: withdrawal.id,
      });
      const signedPayoutXdr = await signTransaction(payoutXdr);
      await submitTx("Send USDC to anchor", "/api/loans/borrow/payout/submit", {
        signedXdr: signedPayoutXdr,
        withdrawalId: withdrawal.id,
      });

      setMessage(null);
      setStatus(withdrawal.status);
      refreshAvailable();
      pollRef.current = setInterval(async () => {
        const res = await fetch(`/api/withdraw/${withdrawal.id}/status`);
        const data = await res.json();
        if (res.ok) {
          setStatus(data.withdrawal.status);
          if (TERMINAL_STATUSES.has(data.withdrawal.status) && pollRef.current) clearInterval(pollRef.current);
        }
      }, 4000);
    } catch (err) {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Withdrawal failed");
      refreshAvailable();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 card">
      <h2 className="text-lg font-semibold">Withdraw Funds</h2>
      <p className="text-sm text-fg-soft">
        Take your money back out to your bank account.
        {availableUsdc != null && ` Available right now: ${availableUsdc.toFixed(2)} USDC; the rest is lent out.`}
      </p>
      <label className="flex flex-col gap-1 text-sm text-fg-soft">
        Amount (TRY)
        <input
          type="number"
          min={1}
          value={tryAmount}
          onChange={(e) => setTryAmount(e.target.value)}
          className="field"
        />
        {limitsHint(limits?.withdraw) && <span className="text-xs text-faint">{limitsHint(limits?.withdraw)}</span>}
      </label>
      <label className="flex flex-col gap-1 text-sm text-fg-soft">
        Bank IBAN
        <input
          type="text"
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          placeholder="TR00 0000 0000 0000 0000 0000 00"
          className="field"
        />
        {iban && !normalizedIban && (
          <span className="text-xs text-warn">That is not a valid Turkish IBAN — check the digits.</span>
        )}
        {normalizedIban && <span className="text-xs text-faint">Paying out to {formatIban(normalizedIban)}</span>}
      </label>
      <button
        onClick={() => void startWithdraw()}
        disabled={busy || !authenticated || !normalizedIban || !(amount > 0) || outOfRange}
        className="ui-button ui-button-primary"
      >
        {busy ? "Working..." : "Withdraw"}
      </button>
      {outOfRange && <p className="text-sm text-warn">{limitsHint(limits?.withdraw)}</p>}
      {message && <p className="text-sm text-muted">{message}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {status && <p className="text-sm font-medium">Status: {status}</p>}
      <TxLinks txs={txs} />
    </div>
  );
}
