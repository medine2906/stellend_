import type { DepositRow, LoanRow } from "./database.types";

export interface ProfileSummary {
  /** TRY the user has sent in via completed deposits. */
  depositedTry: number;
  /** USDC principal of deposits already supplied to the pool. */
  suppliedPrincipalUsdc: number;
  /** What the user's supplied USDC is worth in the pool right now (principal + interest). */
  poolBalanceUsdc: number;
  /** Interest earned so far; approximate, since pool withdrawals aren't recorded. */
  earnedUsdc: number;
  /** USDC borrowed on loans that are still open. */
  borrowedPrincipalUsdc: number;
  /** What the user owes the pool right now (principal + interest). */
  owedUsdc: number;
  /** Interest added to the debt so far. */
  interestOwedUsdc: number;
  openLoans: number;
  /** TRY equivalents at the user's own effective rate (their deposits/loans); null when there is no history to derive a rate from. */
  suppliedPrincipalTry: number | null;
  poolBalanceTry: number | null;
  earnedTry: number | null;
  borrowedPrincipalTry: number | null;
  owedTry: number | null;
  interestOwedTry: number | null;
  /** Share (0..1) of supplied principal the user supplied as TRY; the rest was supplied as USDC. */
  trySupplyShare: number;
}

const OPEN_LOAN_STATUSES = new Set(["active", "defaulted"]);

/** Combines off-chain deposit/loan rows with the user's live on-chain pool balances. */
export function summarizeProfile(
  deposits: Pick<DepositRow, "status" | "try_amount" | "usdc_amount" | "supplied" | "supply_asset">[],
  loans: (Pick<LoanRow, "status" | "borrowed_usdc_amount"> & Partial<Pick<LoanRow, "try_amount">>)[],
  poolBalanceUsdc: number,
  owedUsdc: number,
): ProfileSummary {
  const depositedTry = deposits.filter((d) => d.status === "completed").reduce((sum, d) => sum + d.try_amount, 0);
  const suppliedPrincipalUsdc = deposits
    .filter((d) => d.supplied)
    .reduce((sum, d) => sum + (d.usdc_amount ?? 0), 0);
  const openLoans = loans.filter((l) => OPEN_LOAN_STATUSES.has(l.status));
  const borrowedPrincipalUsdc = openLoans.reduce((sum, l) => sum + l.borrowed_usdc_amount, 0);

  const trySuppliedUsdc = deposits
    .filter((d) => d.supplied && d.supply_asset === "TRY")
    .reduce((sum, d) => sum + (d.usdc_amount ?? 0), 0);
  const supplyTry = deposits.filter((d) => d.supplied && d.usdc_amount).reduce((sum, d) => sum + d.try_amount, 0);
  const supplyRate = suppliedPrincipalUsdc > 0 ? supplyTry / suppliedPrincipalUsdc : null;
  const loansWithTry = openLoans.filter((l) => l.try_amount != null);
  const loanUsdc = loansWithTry.reduce((sum, l) => sum + l.borrowed_usdc_amount, 0);
  const borrowRate =
    loanUsdc > 0 ? loansWithTry.reduce((sum, l) => sum + (l.try_amount ?? 0), 0) / loanUsdc : null;
  const toTry = (usdc: number, rate: number | null) => (rate == null ? null : usdc * rate);

  return {
    depositedTry,
    suppliedPrincipalUsdc,
    poolBalanceUsdc,
    earnedUsdc: Math.max(0, poolBalanceUsdc - suppliedPrincipalUsdc),
    borrowedPrincipalUsdc,
    owedUsdc,
    interestOwedUsdc: Math.max(0, owedUsdc - borrowedPrincipalUsdc),
    openLoans: openLoans.length,
    suppliedPrincipalTry: toTry(suppliedPrincipalUsdc, supplyRate),
    poolBalanceTry: toTry(poolBalanceUsdc, supplyRate),
    earnedTry: toTry(Math.max(0, poolBalanceUsdc - suppliedPrincipalUsdc), supplyRate),
    borrowedPrincipalTry: toTry(borrowedPrincipalUsdc, borrowRate),
    owedTry: toTry(owedUsdc, borrowRate),
    interestOwedTry: toTry(Math.max(0, owedUsdc - borrowedPrincipalUsdc), borrowRate),
    trySupplyShare: suppliedPrincipalUsdc > 0 ? Math.min(1, trySuppliedUsdc / suppliedPrincipalUsdc) : 0,
  };
}

/**
 * Open loan rows the wallet's live Blend debt no longer covers. The debt is per wallet, so it is
 * allocated newest-first; loans left uncovered were already repaid on-chain. Debt at or above the
 * principal sum (interest included) leaves nothing stale. Loans younger than `graceMs` are skipped
 * so a borrow that has not landed on-chain yet is never mistaken for a settled one.
 */
export function staleLoanIds(
  loans: Pick<LoanRow, "id" | "status" | "borrowed_usdc_amount" | "created_at">[],
  owedUsdc: number,
  now = Date.now(),
  graceMs = 10 * 60 * 1000,
): string[] {
  const open = loans
    .filter((l) => OPEN_LOAN_STATUSES.has(l.status))
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  let remaining = owedUsdc;
  const stale: string[] = [];
  for (const l of open) {
    if (remaining >= 0.01) {
      remaining -= l.borrowed_usdc_amount;
    } else if (now - +new Date(l.created_at) > graceMs) {
      stale.push(l.id);
    }
  }
  return stale;
}
