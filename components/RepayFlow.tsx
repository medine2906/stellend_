"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { MIN_DEPOSIT_TRY } from "@/lib/assets";
import { TxLinks, type TxRecord } from "./TxLinks";

interface Loan {
  id: string;
  collateral_asset: string;
  collateral_amount: number;
  borrowed_usdc_amount: number;
  try_amount: number;
}

const TERMINAL_STATUSES = new Set(["completed", "error", "expired", "refunded"]);

/** Inline repayment flow for a single active loan: TRY -> USDC (via anchor), repay, then release collateral if fully repaid. */
export function RepayFlow({ loan, onRepaid }: { loan: Loan; onRepaid: () => void }) {
  const { signTransaction } = useWallet();
  const [open, setOpen] = useState(false);
  const [tryAmount, setTryAmount] = useState(() => loan.try_amount.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const belowMin = !(Number(tryAmount) >= MIN_DEPOSIT_TRY);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

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

  async function prepareWithRestore<T>(url: string, body: unknown): Promise<T> {
    const res = await postJson<T & { needsRestore?: boolean; restoreXdr?: string }>(url, body);
    if (res.needsRestore && res.restoreXdr) {
      const signedRestoreXdr = await signTransaction(res.restoreXdr);
      await submitTx("Restore expired data", "/api/loans/restore/submit", { signedXdr: signedRestoreXdr });
      return postJson<T>(url, body);
    }
    return res;
  }

  async function submitTx(label: string, url: string, body: unknown) {
    const { hash } = await postJson<{ hash: string }>(url, body);
    setTxs((prev) => [...prev, { label, hash }]);
  }

  function waitForDeposit(anchorRef: string): Promise<number> {
    return new Promise((resolve, reject) => {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/loans/${loan.id}/repay/deposit/status?anchorRef=${anchorRef}`);
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

  async function startRepay() {
    setBusy(true);
    setError(null);
    setTxs([]);
    try {
      // 1. Convert TRY to USDC via the anchor, same rails as a lender deposit.
      setMessage("Send TRY to your bank...");
      const { anchorRef } = await postJson<{ anchorRef: string; usdcAmount: number }>(
        `/api/loans/${loan.id}/repay/deposit`,
        { tryAmount: Number(tryAmount) },
      );

      setMessage("Waiting for TRY transfer to convert to USDC...");
      const usdcAmount = await waitForDeposit(anchorRef);

      // 2. Repay the Blend loan with the received USDC.
      setMessage("Repaying loan...");
      const { unsignedXdr: repayXdr } = await prepareWithRestore<{ unsignedXdr: string }>(
        `/api/loans/${loan.id}/repay/prepare`,
        { usdcAmount },
      );
      const signedRepayXdr = await signTransaction(repayXdr);
      // Whether the debt is actually gone is read from the pool by the server; releasing
      // collateral on our own guess would fail against a debt that is still open.
      const { hash, fullyRepaid } = await postJson<{ hash: string; fullyRepaid: boolean }>(
        `/api/loans/${loan.id}/repay/submit`,
        { signedXdr: signedRepayXdr },
      );
      setTxs((prev) => [...prev, { label: "Repay loan", hash }]);

      // 3. On full repayment, release the locked collateral back to the borrower.
      if (fullyRepaid) {
        setMessage("Releasing collateral...");
        const { unsignedXdr: releaseXdr } = await prepareWithRestore<{ unsignedXdr: string }>(
          `/api/loans/${loan.id}/collateral/withdraw/prepare`,
          {},
        );
        const signedReleaseXdr = await signTransaction(releaseXdr);
        await submitTx("Release collateral", `/api/loans/${loan.id}/collateral/withdraw/submit`, { signedXdr: signedReleaseXdr });
        setMessage("Loan repaid and collateral released");
      } else {
        setMessage("Partial repayment applied");
      }

      onRepaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repayment failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="ui-button ui-button-sm"
      >
        Repay
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2 inset-deep p-3 text-sm">
      <label className="flex flex-col gap-1 text-xs text-fg-soft">
        Repayment amount (TRY)
        <input
          type="number"
          min={MIN_DEPOSIT_TRY}
          value={tryAmount}
          onChange={(e) => setTryAmount(e.target.value)}
          className="field field-sm"
        />
      </label>
      <button
        onClick={() => void startRepay()}
        disabled={busy || belowMin}
        className="ui-button ui-button-primary ui-button-sm"
      >
        {busy ? "Processing..." : "Confirm Repayment"}
      </button>
      {belowMin && <p className="text-xs text-warn">Minimum {MIN_DEPOSIT_TRY} TRY</p>}
      {message && <p className="text-xs text-muted">{message}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      <TxLinks txs={txs} />
    </div>
  );
}
