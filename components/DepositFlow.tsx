"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { MIN_DEPOSIT_TRY } from "@/lib/assets";
import { TxLinks, type TxRecord } from "./TxLinks";

interface InstructionField {
  value: string;
  description: string;
}

interface DepositResult {
  deposit: { id: string; status: string; try_amount: number; usdc_amount: number | null };
  instructions?: Record<string, InstructionField>;

}

interface QuotePreview {
  price: string;
  sell_amount: string;
  buy_amount: string;
  fee: { total: string; asset: string };
}

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export function DepositFlow({ supplyAsset = "USDC" }: { supplyAsset?: "USDC" | "TRY" } = {}) {
  const { signTransaction } = useWallet();
  const [tryAmount, setTryAmount] = useState("");
  const [quote, setQuote] = useState<QuotePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DepositResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [supplyStatus, setSupplyStatus] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const suppliedRef = useRef(false);
  const amount = Number(tryAmount);
  const outOfRange = !(amount >= MIN_DEPOSIT_TRY);

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

  async function submitTx(label: string, url: string, body: unknown) {
    const { hash } = await postJson<{ hash: string }>(url, body);
    setTxs((prev) => [...prev, { label, hash }]);
  }

  /** Once a deposit's SEP-6 status is `completed`, route the converted USDC into the Blend pool as supplied liquidity. */
  async function supplyToPool(depositId: string) {
    if (suppliedRef.current) return;
    suppliedRef.current = true;
    try {
      setSupplyStatus("Supplying to lending pool...");
      let prepared = await postJson<{ unsignedXdr?: string; needsRestore?: boolean; restoreXdr?: string }>(
        `/api/deposit/${depositId}/supply/prepare`,
        {},
      );
      if (prepared.needsRestore && prepared.restoreXdr) {
        const signedRestoreXdr = await signTransaction(prepared.restoreXdr);
        await submitTx("Restore expired data", "/api/loans/restore/submit", { signedXdr: signedRestoreXdr });
        prepared = await postJson<{ unsignedXdr?: string }>(`/api/deposit/${depositId}/supply/prepare`, {});
      }
      if (!prepared.unsignedXdr) throw new Error("Failed to prepare supply transaction");

      const signedXdr = await signTransaction(prepared.unsignedXdr);
      await submitTx("Supply to pool", `/api/deposit/${depositId}/supply/submit`, { signedXdr });
      setSupplyStatus("Supplied to lending pool");
    } catch (err) {
      suppliedRef.current = false;
      setSupplyStatus(err instanceof Error ? err.message : "Failed to supply to lending pool");
    }
  }

  /** Sandbox: there is no real bank, so we tell the mock anchor the TRY transfer arrived. */
  async function simulateTransfer(depositId: string) {
    setSimulating(true);
    setError(null);
    try {
      await postJson(`/api/deposit/${depositId}/simulate`, {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimulating(false);
    }
  }

  async function startDeposit() {
    setLoading(true);
    setError(null);
    setResult(null);
    setSupplyStatus(null);
    setTxs([]);
    suppliedRef.current = false;
    try {
      const res = await fetch("/api/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tryAmount: Number(tryAmount), supplyAsset }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Deposit failed");

      setResult(data);
      setStatus(data.deposit.status);

      pollRef.current = setInterval(async () => {
        const pollRes = await fetch(`/api/deposit/${data.deposit.id}/status`);
        const pollData = await pollRes.json();
        if (pollRes.ok) {
          setStatus(pollData.deposit.status);          if (pollData.deposit.status === "completed") {
            void supplyToPool(data.deposit.id);
          }
          if (TERMINAL_STATUSES.has(pollData.deposit.status) && pollRef.current) {
            clearInterval(pollRef.current);
          }
        }
      }, 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setLoading(false);
    }
  }

  /** Ask the anchor for the price/fee so the user sees what they'll receive before committing. */
  async function reviewAmount() {
    setLoading(true);
    setError(null);
    try {
      const data = await postJson<{ quote: QuotePreview }>("/api/deposit/quote", { tryAmount: amount });
      setQuote(data.quote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get quote");
    } finally {
      setLoading(false);
    }
  }

  const presets = [MIN_DEPOSIT_TRY, 500, 1000, 5000];
  const reviewing = quote !== null && !result;

  return (
    <div className="flex flex-col gap-4 card">
      <h2 className="text-lg font-semibold">Add Funds</h2>
      {!result && !reviewing && (
        <>
          <label className="flex flex-col gap-1 text-sm text-fg-soft">
            Amount (TRY)
            <input
              type="number"
              min={MIN_DEPOSIT_TRY}
              step="any"
              value={tryAmount}
              onChange={(e) => setTryAmount(e.target.value)}
              className="field"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {presets.map((v) => (
              <button key={v} type="button" className="ui-button" onClick={() => setTryAmount(String(v))}>
                {v.toLocaleString()} TRY
              </button>
            ))}
          </div>
          <button
            onClick={() => void reviewAmount()}
            disabled={loading || outOfRange}
            className="ui-button ui-button-primary"
          >
            {loading ? "Getting quote..." : "Continue"}
          </button>
        </>
      )}
      {reviewing && (
        <>
          <div className="flex flex-col gap-2 inset p-4 text-sm">
            <p><span className="text-muted">You send: </span>{quote.sell_amount} TRY</p>
            <p><span className="text-muted">Fee: </span>{quote.fee.total} {quote.fee.asset.split(":")[1] ?? quote.fee.asset}</p>
            <p><span className="text-muted">Rate: </span>1 USDC ≈ {Number(quote.price).toFixed(2)} TRY</p>
            <p className="font-medium"><span className="text-muted">You supply: </span>≈ {quote.buy_amount} USDC</p>
            <p className="text-xs text-faint">Final rate is confirmed by the anchor when you confirm.</p>
          </div>
          {/* Lending here is a bet on the dollar as much as on the interest rate, and the
              lender is the one carrying it. Saying so before they commit, not after. */}
          <div className="inset p-4 text-xs text-fg-soft flex flex-col gap-1">
            <p className="font-medium text-warn">What you are taking on</p>
            <p>
              Your lira is converted to dollars and earns interest in dollars. If the lira
              strengthens against the dollar, what you get back is worth less in lira than
              what you put in — the interest may not cover it.
            </p>
            <p>
              Your funds are lent to borrowers against crypto collateral in a Blend pool. If a
              borrower&apos;s collateral falls faster than it can be sold, part of the loss lands on
              lenders. Withdrawals also depend on the pool having idle liquidity at the time.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setQuote(null)} disabled={loading} className="ui-button">Back</button>
            <button onClick={() => void startDeposit()} disabled={loading} className="ui-button ui-button-primary">
              {loading ? "Starting..." : "Confirm & get bank details"}
            </button>
          </div>
        </>
      )}
      {!result && !reviewing && outOfRange && (
        <p className="text-sm text-warn">
          Minimum {MIN_DEPOSIT_TRY} TRY
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {result && (
        <div className="flex flex-col gap-2 inset p-4 text-sm">
          <p className="font-medium">Status: {status}</p>

          {supplyStatus && <p className="text-muted">{supplyStatus}</p>}
          <TxLinks txs={txs} />
          {status === "pending" && process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "PUBLIC" && (
            <button
              onClick={() => void simulateTransfer(result.deposit.id)}
              disabled={simulating}
              className="ui-button ui-button-primary"
            >
              {simulating ? "Simulating..." : "Simulate bank transfer (sandbox)"}
            </button>
          )}
          {result.instructions &&
            Object.entries(result.instructions).map(([key, field]) => (
              <p key={key}>
                <span className="text-muted">{field.description}: </span>
                <span className="font-mono">{field.value}</span>
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

