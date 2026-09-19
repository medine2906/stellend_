/** Highest borrowed/supplied ratio a new borrow may push the pool to, so lenders can always withdraw. */
export const MAX_UTILIZATION = 0.85;

/** USDC in the pool that is not currently lent out, i.e. what lenders can withdraw right now. */
export function idleLiquidity(totalSupplied: number, totalBorrowed: number): number {
  return Math.max(0, totalSupplied - totalBorrowed);
}

/** True when borrowing `extraBorrow` more would push the pool past MAX_UTILIZATION. */
export function exceedsUtilizationCap(totalSupplied: number, totalBorrowed: number, extraBorrow: number): boolean {
  if (totalSupplied <= 0) return true;
  return (totalBorrowed + extraBorrow) / totalSupplied > MAX_UTILIZATION;
}

/** Largest amount that can be borrowed without crossing MAX_UTILIZATION. */
export function maxBorrowable(totalSupplied: number, totalBorrowed: number): number {
  return Math.max(0, totalSupplied * MAX_UTILIZATION - totalBorrowed);
}

/**
 * The date an advance is expected to be closed by, counted from the day it is taken.
 *
 * This is a target, not a deadline, and the UI must never present it as one. Blend has no
 * concept of a term: interest accrues from the first ledger and simply keeps accruing, and
 * the only thing that ever forces a position to close is its health factor. Nothing happens
 * on this date — what the borrower actually feels is the interest, which was running all
 * along.
 */
export const LOAN_TERM_DAYS = 30;
/** Days past the target date before an advance is flagged as overdue for our own reporting. */
export const GRACE_DAYS = 3;
/** Collateral/debt ratio below which we warn the borrower; Blend liquidates below 1. */
export const AT_RISK_RATIO = 1.2;

const DAY_MS = 24 * 60 * 60 * 1000;

export function dueDateFrom(start: Date): Date {
  return new Date(start.getTime() + LOAN_TERM_DAYS * DAY_MS);
}

export type LoanTiming = "current" | "overdue" | "defaulted";

/** `overdue` = past the target date but inside the grace window; `defaulted` = past both. */
export function loanTiming(dueAt: string | Date | null, now: Date): LoanTiming {
  if (!dueAt) return "current";
  const due = new Date(dueAt).getTime();
  if (now.getTime() <= due) return "current";
  return now.getTime() <= due + GRACE_DAYS * DAY_MS ? "overdue" : "defaulted";
}

/**
 * Interest the debt will add over one day at the current rate. The rate is variable — it
 * moves with the pool's utilisation — so this is what today costs, not a projection.
 *
 * Blend compounds per ledger, but over a single day the difference from simple interest is
 * far below the cent this is rounded to for display.
 */
export function dailyInterest(owedUsdc: number, borrowApr: number): number {
  if (!(owedUsdc > 0) || !(borrowApr > 0)) return 0;
  return (owedUsdc * borrowApr) / 365;
}

/**
 * How far the collateral can fall before the pool will sell it, as a fraction (0.3 = 30%).
 * Null when there is no debt, or no collateral left to fall. This is the number that
 * actually matters to a borrower — far more than any date.
 */
export function dropUntilLiquidation(effectiveCollateral: number, effectiveLiabilities: number): number | null {
  if (effectiveLiabilities <= 0 || effectiveCollateral <= 0) return null;
  return Math.max(0, 1 - effectiveLiabilities / effectiveCollateral);
}

export type PositionRisk = "no-debt" | "liquidated" | "at-risk" | "safe";

/**
 * Classifies a borrower's on-chain Blend position. No debt and no collateral
 * left for a wallet with an active loan means the pool's liquidation auction
 * has already consumed it.
 */
export function positionRisk(effectiveCollateral: number, effectiveLiabilities: number): PositionRisk {
  if (effectiveLiabilities <= 0) return effectiveCollateral <= 0 ? "liquidated" : "no-debt";
  return effectiveCollateral / effectiveLiabilities < AT_RISK_RATIO ? "at-risk" : "safe";
}

/**
 * Next off-chain status for an `active` loan, or null to leave it unchanged.
 * Repayment is recorded by the repay flow, so `no-debt` is left alone here.
 */
export function nextLoanStatus(
  dueAt: string | Date | null,
  now: Date,
  risk: PositionRisk,
): "liquidated" | "defaulted" | null {
  if (risk === "liquidated") return "liquidated";
  if (risk !== "no-debt" && loanTiming(dueAt, now) === "defaulted") return "defaulted";
  return null;
}
