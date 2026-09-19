import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getClassicAsset, submitSignedTransaction } from "@/lib/blend";
import { loadWithdrawalIntent } from "@/lib/borrowIntent";
import { requireEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { assertPayment, TransactionMismatchError } from "@/lib/txguard";
import { audit } from "@/lib/audit";
import { recordTransaction } from "@/lib/txlog";
import { getErrorMessage } from "@/lib/errors";

/** Rounding between the quote and the seven-decimal payment amount; one cent of USDC. */
const AMOUNT_TOLERANCE_USDC = 0.01;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const signedXdr = body?.signedXdr as string | undefined;
  const withdrawalId = body?.withdrawalId as string | undefined;
  if (!signedXdr || !withdrawalId) {
    return NextResponse.json({ error: "Missing 'signedXdr' or 'withdrawalId'" }, { status: 400 });
  }

  try {
    const intent = await loadWithdrawalIntent(withdrawalId, session.publicKey);
    if (!intent) return NextResponse.json({ error: "Cash advance not found" }, { status: 404 });
    if (!intent.anchor_account) {
      return NextResponse.json({ error: "This advance has no anchor destination on record" }, { status: 409 });
    }
    if (intent.payout_tx) {
      return NextResponse.json({ error: "This advance has already been paid out to the anchor" }, { status: 409 });
    }

    const usdc = await getClassicAsset(requireEnv("NEXT_PUBLIC_USDC_CONTRACT_ID"), session.publicKey);
    if (!usdc) {
      return NextResponse.json({ error: "Pool USDC has no classic asset to pay out with" }, { status: 502 });
    }

    // Underpaying the anchor leaves the borrower in debt with no cash arriving.
    assertPayment(signedXdr, session.publicKey, {
      to: intent.anchor_account,
      assetCode: usdc.code,
      assetIssuer: usdc.issuer,
      minAmount: intent.usdc_amount - AMOUNT_TOLERANCE_USDC,
    });

    const { hash } = await submitSignedTransaction(signedXdr);

    const { error } = await getSupabaseServiceClient()
      .from("withdrawals")
      .update({ payout_tx: hash, status: "processing" })
      .eq("id", withdrawalId);
    if (error) throw error;

    await recordTransaction(session.publicKey, "payout", hash, { table: "withdrawals", id: withdrawalId });
    await audit("payout_submitted", session.publicKey, "ok", { withdrawalId, usdcAmount: intent.usdc_amount, hash });
    return NextResponse.json({ hash });
  } catch (err) {
    if (err instanceof TransactionMismatchError) {
      await audit("payout_submitted", session.publicKey, "rejected", { withdrawalId, reason: err.message });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to submit payout transaction") },
      { status: 502 },
    );
  }
}
