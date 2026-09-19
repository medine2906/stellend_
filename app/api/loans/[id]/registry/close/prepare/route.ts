import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { buildMarkRepaidTransaction, registryEnabled } from "@/lib/registry";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

/**
 * Builds the `mark_repaid` transaction offered after a full repayment.
 *
 * The loan must exist and belong to the session wallet. The borrower's
 * registry record does not have to be present — calling this when
 * registry_tx is null is still valid (the contract will return NotFound,
 * which the submit route will surface). We let the contract be the
 * authority on whether the record is there.
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
    // Look up the withdrawal that backs this loan to get the withdrawal id
    // (the registry key is derived from the withdrawal id, not the loan id).
    const { data: withdrawal, error } = await getSupabaseServiceClient()
      .from("withdrawals")
      .select("id, registry_tx")
      .eq("loan_id", loanId)
      .eq("borrower_id", borrowerId)
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
