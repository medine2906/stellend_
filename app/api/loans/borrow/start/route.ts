import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertWithinSep6Limits, getSep38Quote, startSep6Withdraw } from "@/lib/anchor";
import { audit } from "@/lib/audit";
import { MIN_DEPOSIT_TRY, TRY_SEP38_ASSET, usdcSep38Asset } from "@/lib/assets";
import { normalizeIban } from "@/lib/iban";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

/**
 * First step of a cash advance, run before any on-chain action: quote the conversion
 * and reserve the SEP-6 withdrawal with the anchor. If the anchor is down or rejects
 * the request, the user finds out here — before any collateral is locked or USDC is
 * borrowed — instead of ending up with debt and no way to cash out.
 *
 * The row this writes is the borrow intent every later step is checked against, so
 * the USDC figure is quoted here rather than accepted from the client.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tryAmount = Number(body?.tryAmount);
  const iban = normalizeIban(String(body?.iban ?? ""));

  if (!Number.isFinite(tryAmount) || tryAmount < MIN_DEPOSIT_TRY) {
    return NextResponse.json({ error: `Amount must be at least ${MIN_DEPOSIT_TRY} TRY` }, { status: 400 });
  }
  if (!iban) {
    return NextResponse.json({ error: "Enter a valid Turkish IBAN (TR followed by 24 digits)" }, { status: 400 });
  }

  try {
    await assertWithinSep6Limits("withdraw", "USDC", tryAmount);

    const quote = await getSep38Quote({
      jwt: session.jwt,
      sellAsset: usdcSep38Asset(),
      buyAsset: TRY_SEP38_ASSET,
      buyAmount: String(tryAmount),
    });
    const usdcAmount = Number(quote.sell_amount);
    if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
      return NextResponse.json({ error: "Anchor returned an unusable quote" }, { status: 502 });
    }

    const withdraw = await startSep6Withdraw({
      jwt: session.jwt,
      account: session.publicKey,
      assetCode: "USDC",
      // This anchor reads `amount` as the fiat (TRY) amount, not the on-chain USDC amount.
      amount: String(tryAmount),
      dest: iban,
      quoteId: quote.id,
    });

    const borrowerId = await getOrCreateProfileId(session.publicKey);
    const supabase = getSupabaseServiceClient();
    const { data: withdrawal, error } = await supabase
      .from("withdrawals")
      .insert({
        borrower_id: borrowerId,
        loan_id: null,
        try_amount: tryAmount,
        usdc_amount: usdcAmount,
        iban,
        anchor_ref: withdraw.id,
        status: "pending",
        anchor_account: withdraw.account_id,
        anchor_memo: withdraw.memo ?? null,
        anchor_memo_type: withdraw.memo_type ?? null,
      })
      .select()
      .single();
    if (error) throw error;

    await audit("borrow_start", session.publicKey, "ok", { withdrawalId: withdrawal.id, tryAmount, usdcAmount });
    return NextResponse.json({ withdrawal, usdcAmount });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to start withdrawal") },
      { status: 502 },
    );
  }
}
