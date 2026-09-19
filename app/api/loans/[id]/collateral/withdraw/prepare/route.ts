import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { withdrawCollateral, RestoreRequiredError } from "@/lib/blend";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

/** Borrower: prepares the Blend `WithdrawCollateral` tx releasing a fully-repaid loan's collateral. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseServiceClient();
  const { data: loan, error } = await supabase.from("loans").select().eq("id", id).single();
  if (error || !loan) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }
  if (loan.status !== "repaid") {
    return NextResponse.json({ error: "Loan must be fully repaid before releasing collateral" }, { status: 409 });
  }

  try {
    const unsignedXdr = await withdrawCollateral(session.publicKey, loan.collateral_asset, loan.collateral_amount);
    return NextResponse.json({ unsignedXdr });
  } catch (err) {
    if (err instanceof RestoreRequiredError) {
      return NextResponse.json({ needsRestore: true, restoreXdr: err.restoreXdr });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to prepare collateral release transaction") },
      { status: 502 },
    );
  }
}
