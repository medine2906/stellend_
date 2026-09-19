import "server-only";
import { getOrCreateProfileId } from "./profiles";
import { getSupabaseServiceClient } from "./supabase";
import type { WithdrawalRow } from "./database.types";

/**
 * Cashing out — whether it is a borrower's advance or a lender withdrawing from the pool —
 * is several signed transactions in a row, so the figures every step is checked against live
 * in the withdrawal row reserved before the first one. This loads that row for its own owner,
 * and is the only place later steps read amounts and destinations from, never the request body.
 */
export async function loadWithdrawalIntent(withdrawalId: string, publicKey: string): Promise<WithdrawalRow | null> {
  const borrowerId = await getOrCreateProfileId(publicKey);
  const { data, error } = await getSupabaseServiceClient()
    .from("withdrawals")
    .select()
    .eq("id", withdrawalId)
    .eq("borrower_id", borrowerId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** The step a cash advance has reached, derived from which transactions have landed. */
export type BorrowStage = "collateral" | "borrow" | "payout" | "settling" | "done";

export function borrowStage(intent: Pick<WithdrawalRow, "collateral_tx" | "borrow_tx" | "payout_tx" | "status">): BorrowStage {
  if (!intent.collateral_tx) return "collateral";
  if (!intent.borrow_tx) return "borrow";
  if (!intent.payout_tx) return "payout";
  return intent.status === "completed" ? "done" : "settling";
}
