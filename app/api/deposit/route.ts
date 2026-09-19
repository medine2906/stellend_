import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSep38Quote, startSep6Deposit } from "@/lib/anchor";

import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { MIN_DEPOSIT_TRY, TRY_SEP38_ASSET, usdcSep38Asset } from "@/lib/assets";
import { getErrorMessage } from "@/lib/errors";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tryAmount = body?.tryAmount as number | undefined;
  if (!tryAmount || tryAmount <= 0) {
    return NextResponse.json({ error: "Missing or invalid 'tryAmount'" }, { status: 400 });
  }
  if (tryAmount < MIN_DEPOSIT_TRY) {
    return NextResponse.json({ error: `Amount must be at least ${MIN_DEPOSIT_TRY} TRY` }, { status: 400 });
  }

  try {

    const quote = await getSep38Quote({
      jwt: session.jwt,
      sellAsset: TRY_SEP38_ASSET,
      buyAsset: usdcSep38Asset(),
      sellAmount: String(tryAmount),
    });

    const deposit = await startSep6Deposit({
      jwt: session.jwt,
      account: session.publicKey,
      assetCode: "USDC",
      // This anchor's minimum-deposit check reads `amount` as the fiat (TRY)
      // amount being sent in, not the on-chain USDC amount from the quote —
      // confirmed by "amount below minimum (50.00 TRY)" firing against the
      // (much smaller) USDC amount.
      amount: String(tryAmount),
      quoteId: quote.id,
    });

    const lenderId = await getOrCreateProfileId(session.publicKey);
    const supabase = getSupabaseServiceClient();
    const { data: row, error } = await supabase
      .from("deposits")
      .insert({
        lender_id: lenderId,
        try_amount: tryAmount,
        usdc_amount: Number(quote.buy_amount),
        anchor_ref: deposit.id,
        status: "pending",
        // Only written for TRY so USDC deposits keep working before the supply_asset migration is applied.
        ...(body?.supplyAsset === "TRY" ? { supply_asset: "TRY" as const } : {}),
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ deposit: row, instructions: deposit.instructions, quote });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to start deposit") },
      { status: 502 },
    );
  }
}

