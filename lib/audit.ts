import "server-only";
import { getSupabaseServiceClient } from "./supabase";

export type AuditAction =
  | "login"
  | "logout"
  | "borrow_start"
  | "collateral_locked"
  | "borrow_submitted"
  | "payout_submitted"
  | "deposit_start"
  | "supply_submitted"
  | "repay_submitted"
  | "sandbox_account_opened"
  | "sandbox_account_closed";

export type AuditOutcome = "ok" | "rejected" | "error";

/**
 * Records a security-relevant event. Never throws and never blocks the caller's result:
 * an audit trail that can fail a withdrawal is worse than a gap in the trail.
 */
export async function audit(
  action: AuditAction,
  publicKey: string | null,
  outcome: AuditOutcome = "ok",
  detail?: Record<string, unknown>,
) {
  try {
    const { error } = await getSupabaseServiceClient()
      .from("audit_log")
      .insert({ stellar_public_key: publicKey, action, outcome, detail: detail ?? null });
    if (error) throw error;
  } catch (err) {
    console.error(`[audit] failed to record ${action}/${outcome}`, err);
  }
}
