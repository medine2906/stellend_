"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet-context";
import type { LoanStatus } from "@/lib/database.types";
import { loanTiming, type PositionRisk } from "@/lib/liquidity";
import Link from "next/link";

interface Loan {
  id: string;
  collateral_asset: string;
  collateral_amount: number;
  borrowed_usdc_amount: number;
  try_amount: number;
  status: LoanStatus;
  created_at: string;
  due_at: string | null;
  /** Null for an advance whose withdrawal row is gone; the registry key is derived from it. */
  withdrawalId: string | null;
  registryRecorded: boolean;
  registry_closed_tx: string | null;
}

interface Debt {
  principalUsdc: number;
  owedUsdc: number;
  interestSoFarUsdc: number;
  borrowApr: number;
  perDayUsdc: number;
}

interface Collateral {
  risk: PositionRisk;
  dropUntilLiquidation: number | null;
  effectiveCollateral: number;
  effectiveLiabilities: number;
}

// "Defaulted" implied a consequence that does not exist: nothing happens on the target date,
// the debt simply keeps accruing. "Past target" says what is actually true.
const STATUS_LABEL: Record<LoanStatus, string> = {
  pending: "Starting",
  active: "Open",
  repaid: "Repaid",
  liquidated: "Collateral sold",
  defaulted: "Past target",
};

const STATUS_COLOR: Record<LoanStatus, string> = {
  pending: "bg-panel-3 text-fg-soft",
  active: "bg-ok-bg text-ok",
  repaid: "bg-info-bg text-info",
  liquidated: "bg-danger-bg text-danger",
  defaulted: "bg-warn-bg text-warn",
};

const usdc = (n: number) => `${n.toFixed(2)} USDC`;

function shortenAsset(assetId: string) {
  return assetId.length > 12 ? `${assetId.slice(0, 6)}...${assetId.slice(-4)}` : assetId;
}

function TargetNote({ dueAt }: { dueAt: string }) {
  const timing = loanTiming(dueAt, new Date());
  const date = new Date(dueAt).toLocaleDateString();
  if (timing === "current") return <p className="text-xs text-muted">Target close: {date}</p>;
  return <p className="text-xs text-warn">Past its {date} target — still open, interest still running.</p>;
}

/** What the debt is doing right now, which is the thing a target date only pretends to be. */
function DebtSummary({ debt }: { debt: Debt }) {
  return (
    <div className="inset flex flex-col gap-2 p-4 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-muted">You owe right now</span>
        <strong className="text-lg text-fg">{usdc(debt.owedUsdc)}</strong>
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span>Borrowed</span>
        <span>{usdc(debt.principalUsdc)}</span>
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span>Interest so far</span>
        <span>+{usdc(debt.interestSoFarUsdc)}</span>
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span>Adding per day, at today&apos;s rate</span>
        <span>+{usdc(debt.perDayUsdc)}</span>
      </div>
      <p className="text-xs text-faint">
        Interest has been running since the day you borrowed and keeps running until you repay. The rate
        ({(debt.borrowApr * 100).toFixed(2)}% APR) moves with how much of the pool is lent out. There is no late fee and
        no fixed deadline — what grows is the interest.
      </p>
    </div>
  );
}

/**
 * The warning that actually matters. Nothing sells a borrower's collateral on a date; it is
 * sold when its value stops covering the debt, so that distance is what we put in front of them.
 */
function CollateralWarning({ collateral }: { collateral: Collateral }) {
  if (collateral.risk === "no-debt" || collateral.dropUntilLiquidation == null) return null;
  const dropPercent = Math.round(collateral.dropUntilLiquidation * 100);
  const atRisk = collateral.risk === "at-risk";

  return (
    <div className={`inset flex flex-col gap-2 p-4 text-sm ${atRisk ? "border border-warn" : ""}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-muted">Collateral can fall</span>
        <strong className={`text-lg ${atRisk ? "text-warn" : "text-fg"}`}>{dropPercent}%</strong>
      </div>
      <p className="text-xs text-muted">
        before the pool sells it to cover what you owe. {collateral.effectiveCollateral.toFixed(2)} of collateral
        against {collateral.effectiveLiabilities.toFixed(2)} of debt, valued by the pool&apos;s price oracle.
      </p>
      {atRisk && (
        <p className="text-sm text-warn">
          That is a narrow margin. Repay part of the debt or add collateral — once the margin reaches zero, anyone can
          have your collateral auctioned off, and you do not get to choose when.
        </p>
      )}
    </div>
  );
}

type SignRegistry = (
  key: string,
  prepareUrl: string,
  submitUrl: string,
  body: Record<string, unknown>,
) => Promise<void>;

/**
 * The advance registry line under a loan: the borrower's own signed copy of it.
 *
 * Every state here is optional and reversible in the sense that matters — declining costs
 * the borrower nothing, and the offer comes back on the next visit. Nothing in the advance,
 * the debt or the repayment reads any of it.
 */
function RegistryRow({ loan, busy, onSign }: { loan: Loan; busy: string | null; onSign: SignRegistry }) {
  // No withdrawal row means no key to derive the record from; there is nothing to offer.
  if (!loan.withdrawalId || loan.status === "pending") return null;

  const openKey = `open:${loan.id}`;
  const closeKey = `close:${loan.id}`;

  if (!loan.registryRecorded) {
    return (
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-panel-3 pt-3">
        <p className="text-xs text-muted">
          You have not signed an on-chain record of this advance yet.
        </p>
        <button
          onClick={() =>
            void onSign(openKey, "/api/loans/borrow/record/prepare", "/api/loans/borrow/record/submit", {
              withdrawalId: loan.withdrawalId,
            })
          }
          disabled={busy !== null}
          className="ui-button ui-button-sm"
        >
          {busy === openKey ? "Signing…" : "Sign record"}
        </button>
      </div>
    );
  }

  if (loan.status === "repaid" && !loan.registry_closed_tx) {
    return (
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-panel-3 pt-3">
        <p className="text-xs text-muted">Recorded on-chain. You can mark it settled there too.</p>
        <button
          onClick={() =>
            void onSign(closeKey, `/api/loans/${loan.id}/registry/close/prepare`, `/api/loans/${loan.id}/registry/close/submit`, {})
          }
          disabled={busy !== null}
          className="ui-button ui-button-sm"
        >
          {busy === closeKey ? "Signing…" : "Mark settled on-chain"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-panel-3 pt-3">
      <p className="text-xs text-muted">
        {loan.registry_closed_tx ? "Recorded and marked settled on-chain." : "Recorded on-chain under your own key."}
      </p>
      <OnChainRecord loanId={loan.id} />
    </div>
  );
}

interface ChainRecord {
  borrower: string;
  usdcAmount: number;
  tryAmount: number;
  payoutRef: string;
  openedAt: string;
  dueAt: string;
  status: "open" | "repaid";
}

interface RecordResponse {
  advanceId: string;
  record: ChainRecord | null;
  cached: { registryTx: string | null; recordedAt: string | null };
  ours: { usdcAmount: number; tryAmount: number; dueAt: string | null; status: LoanStatus } | null;
}

/**
 * The record as the contract holds it, fetched on demand.
 *
 * Everything else in this list is our database describing itself. This is the one place
 * the borrower sees the ledger's own answer, which is the entire reason the contract
 * exists — so it is read live rather than cached, and a disagreement with our numbers is
 * shown rather than smoothed over.
 */
function OnChainRecord({ loanId }: { loanId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RecordResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (data || state === "loading") return;
    setState("loading");
    try {
      const res = await fetch(`/api/loans/${loanId}/registry`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setData(body);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-2">
      <button onClick={() => void toggle()} className="text-xs text-accent underline-offset-2 hover:underline">
        {open ? "Hide the on-chain record" : "Show the on-chain record"}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1 text-xs">
          {state === "loading" && <p className="text-muted">Reading the contract…</p>}
          {state === "error" && <p className="text-warn">Could not reach the network to read it. Your record is unaffected.</p>}

          {data?.record && (
            <>
              <div className="flex justify-between">
                <span className="text-muted">Recorded debt</span>
                <span className="text-fg">{data.record.usdcAmount.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Recorded payout</span>
                <span className="text-fg">{data.record.tryAmount.toFixed(2)} TRY</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Signed</span>
                <span className="text-fg">{new Date(data.record.openedAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Date you committed to</span>
                <span className="text-fg">{new Date(data.record.dueAt).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Status on chain</span>
                <span className="text-fg">{data.record.status === "repaid" ? "Settled" : "Open"}</span>
              </div>
              <p className="mt-1 break-all text-faint">Payout reference: {data.record.payoutRef}</p>
              <p className="text-faint">
                A hash of your anchor reference and IBAN — never the IBAN itself. Keep both and you can recompute it
                to prove which payout this record covers.
              </p>
              {data.ours && Math.abs(data.ours.usdcAmount - data.record.usdcAmount) > 0.005 && (
                <p className="text-warn">
                  Our records say {data.ours.usdcAmount.toFixed(2)} USDC. The chain is the one to trust.
                </p>
              )}
            </>
          )}

          {data && !data.record && state === "idle" && (
            <p className="text-muted">
              The record could not be read right now — the network may be unreachable, or the entry may have been
              archived. That is not the same as it not existing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function LoansList() {
  const { authenticated, signTransaction } = useWallet();
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [debt, setDebt] = useState<Debt | null>(null);
  const [collateral, setCollateral] = useState<Collateral | null>(null);
  const [registryEnabled, setRegistryEnabled] = useState(false);
  const [registryBusy, setRegistryBusy] = useState<string | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/loans/mine", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setLoans(data.loans);
        setDebt(data.debt ?? null);
        setCollateral(data.collateral ?? null);
        setRegistryEnabled(Boolean(data.registryEnabled));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load loans"));
  }, []);

  /**
   * Signs one of the two registry transactions. Both are optional receipts, so a failure
   * is reported next to the button and never touches the list itself.
   */
  const signRegistry = useCallback(
    async (key: string, prepareUrl: string, submitUrl: string, body: Record<string, unknown>) => {
      setRegistryBusy(key);
      setRegistryError(null);
      try {
        const prepared = await fetch(prepareUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const preparedData = await prepared.json();
        if (!prepared.ok) throw new Error(preparedData.error);

        const signedXdr = await signTransaction(preparedData.unsignedXdr);
        const submitted = await fetch(submitUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, signedXdr }),
        });
        const submittedData = await submitted.json();
        if (!submitted.ok) throw new Error(submittedData.error);
        refresh();
      } catch (err) {
        setRegistryError(err instanceof Error ? err.message : "Could not sign the record");
      } finally {
        setRegistryBusy(null);
      }
    },
    [refresh, signTransaction],
  );

  useEffect(() => {
    if (!authenticated) return;
    refresh();
  }, [authenticated, refresh]);

  if (!authenticated) return null;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!loans) return <p className="text-sm text-muted">Loading your cash advances...</p>;

  if (loans.length === 0) {
    return (
      <div className="card">
        <h3 className="text-sm font-medium text-fg-soft">Your Cash Advances</h3>
        <p className="mt-2 text-sm text-muted">You don&apos;t have any cash advances yet.</p>
      </div>
    );
  }

  const hasOpen = loans.some((l) => l.status === "active" || l.status === "defaulted");

  return (
    <div className="flex flex-col gap-3 card">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-fg-soft">Your Cash Advances</h3>
        {hasOpen && (
          <Link href="/dashboard/repay" className="ui-button ui-button-sm">
            Repay
          </Link>
        )}
      </div>

      {hasOpen && debt && <DebtSummary debt={debt} />}
      {hasOpen && collateral && <CollateralWarning collateral={collateral} />}
      {hasOpen && !debt && (
        <p className="text-xs text-muted">Live balances are temporarily unavailable; the amounts below are what you borrowed.</p>
      )}

      <ul className="flex flex-col gap-3">
        {loans.map((loan) => (
          <li key={loan.id} className="inset p-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-fg">{loan.try_amount.toFixed(2)} TRY</p>
                <p className="text-xs text-muted">
                  Collateral: {loan.collateral_amount} {shortenAsset(loan.collateral_asset)} · Borrowed{" "}
                  {new Date(loan.created_at).toLocaleDateString()}
                </p>
                {loan.due_at && (loan.status === "active" || loan.status === "defaulted") && (
                  <TargetNote dueAt={loan.due_at} />
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLOR[loan.status]}`}>
                  {STATUS_LABEL[loan.status]}
                </span>
              </div>
            </div>
            {registryEnabled && <RegistryRow loan={loan} busy={registryBusy} onSign={signRegistry} />}
          </li>
        ))}
      </ul>
      {registryError && <p className="text-xs text-warn">{registryError}</p>}
    </div>
  );
}
