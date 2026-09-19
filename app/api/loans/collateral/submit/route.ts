import { NextRequest, NextResponse } from "next/server";
import { RequestType } from "@blend-capital/blend-sdk";
import { getSession } from "@/lib/session";
import { submitSignedTransaction } from "@/lib/blend";
import { loadWithdrawalIntent } from "@/lib/borrowIntent";
import { requireEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { assertPoolRequest, toFixedAmount, TransactionMismatchError } from "@/lib/txguard";
import { audit } from "@/lib/audit";
import { recordTransaction } from "@/lib/txlog";
import { getErrorMessage } from "@/lib/errors";

/**
 * Locks the borrower's collateral. The amount recorded against the loan is decoded from
 * the signed transaction itself, so the loan can never claim more collateral than the
 * chain actually holds.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const signedXdr = body?.signedXdr as string | undefined;
  const withdrawalId = body?.withdrawalId as string | undefined;
  const asset = body?.asset as string | undefined;
  const amount = Number(body?.amount);
  const decimals = Number(body?.decimals ?? 7);

  if (!signedXdr || !withdrawalId || !asset || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Missing 'signedXdr', 'withdrawalId', 'asset', or 'amount'" }, { status: 400 });
  }

  try {
    const intent = await loadWithdrawalIntent(withdrawalId, session.publicKey);
    if (!intent) return NextResponse.json({ error: "Cash advance not found" }, { status: 404 });
    if (intent.collateral_tx) {
      return NextResponse.json({ error: "Collateral for this advance is already locked" }, { status: 409 });
    }

    const request = assertPoolRequest(signedXdr, session.publicKey, requireEnv("NEXT_PUBLIC_BLEND_POOL_ID"), {
      requestType: RequestType.SupplyCollateral,
      asset,
      minAmount: toFixedAmount(amount, decimals),
    });

    const { hash } = await submitSignedTransaction(signedXdr);

    const { error } = await getSupabaseServiceClient()
      .from("withdrawals")
      .update({
        collateral_asset: asset,
        collateral_amount: Number(request.amount) / 10 ** decimals,
        collateral_tx: hash,
      })
      .eq("id", withdrawalId);
    if (error) throw error;

    await recordTransaction(session.publicKey, "collateral", hash, { table: "withdrawals", id: withdrawalId });
    await audit("collateral_locked", session.publicKey, "ok", { withdrawalId, asset, amount, hash });
    return NextResponse.json({ hash });
  } catch (err) {
    if (err instanceof TransactionMismatchError) {
      await audit("collateral_locked", session.publicKey, "rejected", { withdrawalId, reason: err.message });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to submit collateral transaction") },
      { status: 502 },
    );
  }
}
