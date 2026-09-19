"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import { fetchSandboxAccount } from "@/lib/sandboxAccount";
import { StatusTimeline, type TimelineStep } from "./StatusTimeline";
import { TxLinks, type TxRecord } from "./TxLinks";
import { MIN_DEPOSIT_TRY } from "@/lib/assets";
import { getErrorMessage } from "@/lib/errors";
import { formatIban, normalizeIban } from "@/lib/iban";
import { LOAN_TERM_DAYS } from "@/lib/liquidity";
import { amountOutOfRange, limitsHint, useAnchorLimits } from "@/lib/useAnchorLimits";

const STEPS: TimelineStep[] = [
  { key: "trustline", label: "Prepare to receive USDC" },
  { key: "collateral", label: "Lock crypto collateral" },
  { key: "borrow", label: "Borrow against it" },
  { key: "transfer", label: "Send TRY to your bank" },
  { key: "done", label: "Cash in your account" },
];

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

type BorrowStage = "collateral" | "borrow" | "payout" | "settling";

interface CollateralOption {
  id: string;
  symbol: string;
  decimals: number;
  collateralFactor: number;
  oraclePrice: number | null;
}

interface PendingAdvance {
  withdrawalId: string;
  stage: BorrowStage;
  tryAmount: number;
  usdcAmount: number;
  iban: string;
  collateralAsset: string | null;
  collateralAmount: number | null;
  createdAt: string;
  txs: TxRecord[];
}

interface StepState {
  index: number;
  failed: boolean;
  message: string | null;
}

export function BorrowFlow() {
  const { publicKey, authenticated, signTransaction } = useWallet();
  const [options, setOptions] = useState<CollateralOption[] | null>(null);
  const [collateralAsset, setCollateralAsset] = useState("");
  const [collateralAmount, setCollateralAmount] = useState("100");
  const [tryAmount, setTryAmount] = useState("500");
  const [iban, setIban] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<StepState>({ index: -1, failed: false, message: null });
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [pending, setPending] = useState<PendingAdvance | null>(null);
  const [withdrawalStatus, setWithdrawalStatus] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const limits = useAnchorLimits();

  const selected = options?.find((o) => o.id === collateralAsset) ?? null;
  const normalizedIban = normalizeIban(iban);
  const outOfRange = amountOutOfRange(limits?.withdraw, Number(tryAmount)) || !(Number(tryAmount) >= MIN_DEPOSIT_TRY);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Only assets this pool actually lends against are offered; typing a contract address
  // by hand made it possible to lock an asset worth nothing as collateral.
  useEffect(() => {
    void fetch("/api/loans/collateral/options")
      .then((res) => (res.ok ? res.json() : { options: [] }))
      .then((data) => {
        setOptions(data.options ?? []);
        setCollateralAsset((cur) => cur || data.options?.[0]?.id || "");
      })
      .catch(() => setOptions([]));
  }, []);

  // Pay out to the sandbox bank account linked to this wallet, unless the user typed another IBAN.
  useEffect(() => {
    if (!authenticated) return;
    void fetchSandboxAccount().then((acc) => { if (acc) setIban((cur) => cur || acc.iban); }).catch(() => {});
  }, [authenticated, publicKey]);

  const loadPending = useCallback(async () => {
    if (!authenticated) return;
    try {
      const res = await fetch("/api/loans/borrow/resume");
      if (!res.ok) return;
      const { pending: found } = await res.json();
      setPending(found ?? null);
    } catch {
      // An unreachable resume check just means no offer to resume; the flow still works.
    }
  }, [authenticated]);

  // A closed tab between two signatures leaves an advance half-finished; find it on load.
  useEffect(() => { void loadPending(); }, [loadPending]);

  async function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Request to ${url} failed`);
    return data;
  }

  /**
   * Calls a Soroban-invoke `prepare` endpoint; if the simulation reports
   * expired ledger entries, signs and submits the restore transaction first,
   * then retries — transparent to the caller.
   */
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

  function watchWithdrawal(withdrawalId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/withdraw/${withdrawalId}/status`);
      const data = await res.json();
      if (!res.ok) return;
      setWithdrawalStatus(data.withdrawal.status);
      if (TERMINAL_STATUSES.has(data.withdrawal.status)) {
        const completed = data.withdrawal.status === "completed";
        setStep({ index: completed ? 4 : 3, failed: !completed, message: null });
        if (completed) setPending(null);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 4000);
  }

  /**
   * Runs the advance from `stage` onward. Each step is skipped if it already landed,
   * so this is both the happy path (from "collateral") and the resume path.
   */
  async function runAdvance(intent: { withdrawalId: string; stage: BorrowStage; asset: string; amount: number }) {
    const { withdrawalId, asset, amount } = intent;
    let stage = intent.stage;

    if (stage === "collateral") {
      // The trustline has to exist before the borrowed USDC can land.
      setStep({ index: 0, failed: false, message: null });
      const trustline = await postJson<{ needed: boolean; unsignedXdr?: string }>("/api/loans/trustline/prepare", {});
      if (trustline.needed && trustline.unsignedXdr) {
        const signedTrustlineXdr = await signTransaction(trustline.unsignedXdr);
        await submitTx("USDC trustline", "/api/loans/trustline/submit", { signedXdr: signedTrustlineXdr });
      }

      setStep({ index: 1, failed: false, message: null });
      const { unsignedXdr } = await prepareWithRestore<{ unsignedXdr: string }>("/api/loans/collateral/prepare", {
        asset,
        amount,
        decimals: selected?.decimals ?? 7,
      });
      const signedXdr = await signTransaction(unsignedXdr);
      await submitTx("Lock collateral", "/api/loans/collateral/submit", {
        signedXdr,
        withdrawalId,
        asset,
        amount,
        decimals: selected?.decimals ?? 7,
      });
      stage = "borrow";
    }

    if (stage === "borrow") {
      setStep({ index: 2, failed: false, message: null });
      const { unsignedXdr } = await prepareWithRestore<{ unsignedXdr: string }>("/api/loans/borrow/prepare", { withdrawalId });
      const signedXdr = await signTransaction(unsignedXdr);
      await submitTx("Borrow USDC", "/api/loans/borrow/submit", { signedXdr, withdrawalId });
      stage = "payout";
    }

    if (stage === "payout") {
      // Until this lands the borrower holds debt and no cash, so it is the step
      // resuming exists for.
      setStep({ index: 3, failed: false, message: null });
      const { unsignedXdr } = await postJson<{ unsignedXdr: string }>("/api/loans/borrow/payout/prepare", { withdrawalId });
      const signedXdr = await signTransaction(unsignedXdr);
      await submitTx("Send USDC to anchor", "/api/loans/borrow/payout/submit", { signedXdr, withdrawalId });
    }

    setStep({ index: 3, failed: false, message: null });
    watchWithdrawal(withdrawalId);
  }

  async function startBorrow() {
    if (!publicKey || !normalizedIban || !selected) return;
    setBusy(true);
    setTxs([]);
    setStep({ index: 0, failed: false, message: null });

    try {
      // Reserve the TRY withdrawal with the anchor before touching the chain: if the
      // anchor is unavailable we stop here, with nothing locked or borrowed yet.
      const { withdrawal } = await postJson<{ withdrawal: { id: string; status: string } }>(
        "/api/loans/borrow/start",
        { tryAmount: Number(tryAmount), iban: normalizedIban },
      );
      setWithdrawalStatus(withdrawal.status);
      await runAdvance({
        withdrawalId: withdrawal.id,
        stage: "collateral",
        asset: selected.id,
        amount: Number(collateralAmount),
      });
    } catch (err) {
      setStep((prev) => ({ ...prev, failed: true, message: getErrorMessage(err, "Cash advance failed") }));
      void loadPending();
    } finally {
      setBusy(false);
    }
  }

  async function resumeBorrow() {
    if (!pending) return;
    setBusy(true);
    setTxs(pending.txs);
    try {
      if (pending.stage === "settling") {
        setStep({ index: 3, failed: false, message: null });
        watchWithdrawal(pending.withdrawalId);
        return;
      }
      await runAdvance({
        withdrawalId: pending.withdrawalId,
        stage: pending.stage,
        asset: pending.collateralAsset ?? selected?.id ?? collateralAsset,
        amount: pending.collateralAmount ?? Number(collateralAmount),
      });
      setPending(null);
    } catch (err) {
      setStep((prev) => ({ ...prev, failed: true, message: getErrorMessage(err, "Could not resume") }));
      void loadPending();
    } finally {
      setBusy(false);
    }
  }

  async function discardPending() {
    if (!pending) return;
    try {
      await postJson("/api/loans/borrow/resume", { withdrawalId: pending.withdrawalId }, "DELETE");
      setPending(null);
    } catch (err) {
      setStep((prev) => ({ ...prev, failed: true, message: getErrorMessage(err, "Could not discard") }));
    }
  }

  const collateralValue = selected?.oraclePrice != null ? Number(collateralAmount) * selected.oraclePrice : null;
  const maxAgainstCollateral = collateralValue != null && selected ? collateralValue * selected.collateralFactor : null;

  return (
    <div className="flex flex-col gap-4 card">
      <h2 className="text-lg font-semibold">Get Cash Advance</h2>

      {!authenticated && <p className="text-sm text-muted">Sign in with your wallet to get started.</p>}

      {pending && (
        <div className="inset p-4 flex flex-col gap-2">
          <p className="text-sm font-medium text-warn">You have an unfinished cash advance</p>
          <p className="text-xs text-muted">
            {pending.tryAmount.toLocaleString("tr-TR")} TRY, started {new Date(pending.createdAt).toLocaleString("tr-TR")}.
            {pending.stage === "payout"
              ? " The USDC is borrowed but has not reached the anchor yet — finish it to get your cash."
              : " Pick up where you left off instead of starting a new one."}
          </p>
          <div className="flex gap-2">
            <button onClick={() => void resumeBorrow()} disabled={busy} className="ui-button ui-button-primary">
              {busy ? "Resuming…" : "Resume"}
            </button>
            {pending.stage === "collateral" && (
              <button onClick={() => void discardPending()} disabled={busy} className="ui-button">
                Discard
              </button>
            )}
          </div>
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm text-fg-soft">
        Which crypto are you using?
        <select
          value={collateralAsset}
          onChange={(e) => setCollateralAsset(e.target.value)}
          className="field"
          disabled={!options?.length}
        >
          {options === null && <option>Loading assets…</option>}
          {options?.length === 0 && <option value="">No collateral assets available</option>}
          {options?.map((option) => (
            <option key={option.id} value={option.id}>
              {option.symbol} — up to {(option.collateralFactor * 100).toFixed(0)}% borrowable
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-fg-soft">
        How much of it?
        <input
          type="number"
          min={0}
          value={collateralAmount}
          onChange={(e) => setCollateralAmount(e.target.value)}
          className="field"
        />
        <span className="text-xs text-faint">
          {collateralValue != null && maxAgainstCollateral != null
            ? `≈ $${collateralValue.toFixed(2)} locked, up to $${maxAgainstCollateral.toFixed(2)} borrowable`
            : "Collateral value unavailable — the pool's price oracle is not responding"}
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm text-fg-soft">
        Cash advance amount (TRY)
        <input
          type="number"
          min={MIN_DEPOSIT_TRY}
          value={tryAmount}
          onChange={(e) => setTryAmount(e.target.value)}
          className="field"
        />
        {limitsHint(limits?.withdraw) && (
          <span className="text-xs text-faint">{limitsHint(limits?.withdraw)}</span>
        )}
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

      <p className="text-xs text-muted">
        You keep your crypto. Interest starts the moment you borrow and runs until you repay — there is no deadline and
        no late fee, the debt just grows. We suggest closing within {LOAN_TERM_DAYS} days to keep it small. If your
        collateral&apos;s price falls far enough that it no longer covers the debt, the pool sells it.
      </p>

      <button
        onClick={() => void startBorrow()}
        disabled={busy || !authenticated || !selected || !normalizedIban || outOfRange || Boolean(pending)}
        className="ui-button ui-button-primary"
      >
        {busy ? "Processing..." : "Get Cash Advance"}
      </button>
      {outOfRange && <p className="text-sm text-warn">{limitsHint(limits?.withdraw) ?? `Minimum ${MIN_DEPOSIT_TRY} TRY`}</p>}

      {step.index >= 0 && (
        <div className="inset p-4">
          <StatusTimeline steps={STEPS} currentIndex={step.index} failed={step.failed} />
          {step.message && <p className="mt-3 text-sm text-danger">{step.message}</p>}
          {withdrawalStatus && <p className="mt-3 text-xs text-muted">Transfer status: {withdrawalStatus}</p>}
        </div>
      )}
      <TxLinks txs={txs} />
    </div>
  );
}
