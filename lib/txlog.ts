import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";

export type TxKind =
  | "restore"
  | "trustline"
  | "collateral"
  | "borrow"
  | "payout"
  | "repay"
  | "collateral_release"
  | "supply"
  | "pool_withdraw";

/**
 * Records a submitted on-chain transaction so it shows up in the user's history.
 * Never throws: the transaction is already on-chain, so a logging failure must not
 * turn a successful submit into an error response.
 */
export async function recordTransaction(
  publicKey: string,
  kind: TxKind,
  hash: string,
  reference?: { table: string; id: string },
) {
  try {
    const profileId = await getOrCreateProfileId(publicKey);
    const { error } = await getSupabaseServiceClient()
      .from("transactions_log")
      .insert({
        profile_id: profileId,
        kind,
        reference_table: reference?.table ?? "profiles",
        reference_id: reference?.id ?? profileId,
        detail: { hash },
      });
    if (error) throw error;
  } catch (err) {
    console.error(`Failed to log ${kind} transaction ${hash}`, err);
  }
}
