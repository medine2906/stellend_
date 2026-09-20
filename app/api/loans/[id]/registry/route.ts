import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { advanceId, readAdvanceRecord, registryEnabled } from "@/lib/registry";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

/**
 * The advance registry record for this loan, read from the chain.
 *
 * Everywhere else the registry appears, the borrower is looking at our cached flag —
 * which is our word again, the very thing the contract exists to stop being the only
 * record. This route reads the contract itself, so the numbers on the page are the ones
 * anyone else querying the ledger would see.
 *
 * The cached columns are returned alongside rather than instead: they carry the
 * transaction hashes, which the record itself does not.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const supabase = getSupabaseServiceClient();

    // Scoped to the caller's own profile: a loan id alone must never reveal
    // somebody else's advance, even though the record is public on chain.
    const { data: withdrawal, error } = await supabase
      .from("withdrawals")
      .select("id, registry_tx, registry_recorded_at")
      .eq("loan_id", loanId)
      .eq("borrower_id", borrowerId)
      .maybeSingle();
    if (error) throw error;
    if (!withdrawal) {
      return NextResponse.json({ error: "Loan not found or no advance record" }, { status: 404 });
    }

    const { data: loan, error: loanError } = await supabase
      .from("loans")
      .select("borrowed_usdc_amount, try_amount, due_at, status")
      .eq("id", loanId)
      .eq("borrower_id", borrowerId)
      .maybeSingle();
    if (loanError) throw loanError;

    const record = await readAdvanceRecord(session.publicKey, withdrawal.id);

    return NextResponse.json(
      {
        advanceId: advanceId(withdrawal.id).toString("hex"),
        /** Null means the record could not be read right now — never that it is absent. */
        record,
        cached: {
          registryTx: withdrawal.registry_tx,
          recordedAt: withdrawal.registry_recorded_at,
        },
        /** What our own database says, so the page can show the two side by side. */
        ours: loan
          ? {
              usdcAmount: loan.borrowed_usdc_amount,
              tryAmount: loan.try_amount,
              dueAt: loan.due_at,
              status: loan.status,
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to read the advance record") },
      { status: 502 },
    );
  }
}
