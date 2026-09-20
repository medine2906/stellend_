import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { buildMarkRepaidTransaction, registryEnabled } from "@/lib/registry";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

/**
 * Builds the `mark_repaid` transaction offered after a full repayment.
 *
 * The loan must exist, belong to the session wallet, and be settled. That last check is
 * ours to make: the contract cannot see the pool, so it will happily record whatever a
 * borrower signs. Offering this while debt is still outstanding would make us the ones
 * handing them a signed "settled" receipt that the pool contradicts.
 *
 * The registry record itself does not have to be present — the contract returns NotFound
 * and the submit route surfaces it. We let the contract be the authority on that.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!registryEnabled()) {
    return NextResponse.json({ error: "Registry feature is not configured" }, { status: 404 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id: loanId } = await params;

  try {
    const borrowerId = await getOrCreateProfileId(session.publicKey);

    // The repaid status is written by the repay route only after it reads the pool, so
    // this is a chain-backed answer rather than something the caller asserted.
    const { data: loan, error: loanError } = await getSupabaseServiceClient()
      .from("loans")
      .select("status")
      .eq("id", loanId)
      .eq("borrower_id", borrowerId)
      .maybeSingle();
    if (loanError) throw loanError;
    if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    if (loan.status !== "repaid") {
      return NextResponse.json(
        { error: "This advance is not settled yet — its debt is still outstanding in the pool" },
        { status: 409 },
      );
    }

    // The registry key is derived from the withdrawal id, not the loan id.
    const { data: withdrawal, error } = await getSupabaseServiceClient()
      .from("withdrawals")
      .select("id, registry_tx")
      .eq("loan_id", loanId)
      .eq("borrower_id", borrowerId)
      // Oldest first and one row only: nothing stops a loan carrying more than one
      // withdrawal row, and maybeSingle would throw rather than pick the advance it began as.
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!withdrawal) {
      return NextResponse.json({ error: "Loan not found or no advance record" }, { status: 404 });
    }

    const unsignedXdr = await buildMarkRepaidTransaction(session.publicKey, withdrawal.id);
    return NextResponse.json({ unsignedXdr });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to prepare mark_repaid transaction") },
      { status: 502 },
    );
  }
}
