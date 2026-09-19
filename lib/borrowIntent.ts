import "server-only";
import { getSep6Transaction } from "./anchor";
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

/**
 * An advance started before the destination columns existed has no anchor account on
 * record. The anchor still holds it under `anchor_ref`, so ask it again and write the
 * answer down. The address comes from the anchor, never from the client.
 */
export async function ensureAnchorDestination(intent: WithdrawalRow, jwt: string): Promise<WithdrawalRow> {
  if (intent.anchor_account) return intent;

  const tx = await getSep6Transaction(jwt, intent.anchor_ref);
  if (!tx.withdraw_anchor_account) return intent;

  const destination = {
    anchor_account: tx.withdraw_anchor_account,
    anchor_memo: tx.withdraw_memo ?? null,
    anchor_memo_type: tx.withdraw_memo_type ?? null,
  };
  const { error } = await getSupabaseServiceClient()
    .from("withdrawals")
    .update(destination)
    .eq("id", intent.id)
    .is("anchor_account", null);
  if (error) throw error;
  return { ...intent, ...destination };
}

/** The step a cash advance has reached, derived from which transactions have landed. */
export type BorrowStage = "collateral" | "borrow" | "payout" | "settling" | "done";

export function borrowStage(intent: Pick<WithdrawalRow, "collateral_tx" | "borrow_tx" | "payout_tx" | "status">): BorrowStage {
  if (!intent.collateral_tx) return "collateral";
  if (!intent.borrow_tx) return "borrow";
  if (!intent.payout_tx) return "payout";
  return intent.status === "completed" ? "done" : "settling";
}
