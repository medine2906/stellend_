import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { supplyLiquidity, RestoreRequiredError } from "@/lib/blend";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

/**
 * Lender: prepares the Blend `Supply` transaction for a completed, not-yet-
 * supplied deposit's USDC amount. The lender's wallet signs the returned XDR.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseServiceClient();
  const { data: deposit, error } = await supabase.from("deposits").select().eq("id", id).single();
  if (error || !deposit) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }
  if (deposit.status !== "completed") {
    return NextResponse.json({ error: "Deposit has not completed yet" }, { status: 409 });
  }
  if (deposit.supplied) {
    return NextResponse.json({ error: "Deposit has already been supplied" }, { status: 409 });
  }
  if (!deposit.usdc_amount || deposit.usdc_amount <= 0) {
    return NextResponse.json({ error: "Deposit has no USDC amount to supply" }, { status: 409 });
  }

  try {
    const unsignedXdr = await supplyLiquidity(session.publicKey, deposit.usdc_amount);
    return NextResponse.json({ unsignedXdr });
  } catch (err) {
    if (err instanceof RestoreRequiredError) {
      return NextResponse.json({ needsRestore: true, restoreXdr: err.restoreXdr });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to prepare supply transaction") },
      { status: 502 },
    );
  }
}
