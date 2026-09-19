import { NextRequest, NextResponse } from "next/server";
import { RequestType } from "@blend-capital/blend-sdk";
import { getSession } from "@/lib/session";
import { submitSignedTransaction } from "@/lib/blend";
import { requireEnv } from "@/lib/env";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { assertPoolRequest, toFixedAmount, TransactionMismatchError } from "@/lib/txguard";
import { recordTransaction } from "@/lib/txlog";
import { getErrorMessage } from "@/lib/errors";

/** Rounding between the anchor's quote and the pool's fixed-point maths; one cent of USDC. */
const AMOUNT_TOLERANCE_USDC = 0.01;

/** Lender: submits the signed Blend `Supply` transaction and marks the deposit as supplied. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const signedXdr = body?.signedXdr as string | undefined;
  if (!signedXdr) {
    return NextResponse.json({ error: "Missing 'signedXdr'" }, { status: 400 });
  }

  try {
    const lenderId = await getOrCreateProfileId(session.publicKey);
    const supabase = getSupabaseServiceClient();
    const { data: deposit, error: depositError } = await supabase
      .from("deposits")
      .select()
      .eq("id", id)
      .eq("lender_id", lenderId)
      .maybeSingle();
    if (depositError) throw depositError;
    if (!deposit) return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
    if (deposit.supplied) {
      return NextResponse.json({ error: "Deposit has already been supplied" }, { status: 409 });
    }

    // Marking the deposit supplied is what credits the lender's position, so the
    // transaction has to actually supply at least what the deposit converted to.
    assertPoolRequest(signedXdr, session.publicKey, requireEnv("NEXT_PUBLIC_BLEND_POOL_ID"), {
      requestType: RequestType.Supply,
      asset: requireEnv("NEXT_PUBLIC_USDC_CONTRACT_ID"),
      minAmount: toFixedAmount((deposit.usdc_amount ?? 0) - AMOUNT_TOLERANCE_USDC),
    });

    const { hash } = await submitSignedTransaction(signedXdr);

    const { error } = await supabase.from("deposits").update({ supplied: true }).eq("id", id);
    if (error) throw error;

    await recordTransaction(session.publicKey, "supply", hash, { table: "deposits", id });

    return NextResponse.json({ hash });
  } catch (err) {
    if (err instanceof TransactionMismatchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to submit supply transaction") },
      { status: 502 },
    );
  }
}
