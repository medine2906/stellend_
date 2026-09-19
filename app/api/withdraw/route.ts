import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertWithinSep6Limits, getSep38Quote, startSep6Withdraw } from "@/lib/anchor";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { TRY_SEP38_ASSET, usdcSep38Asset } from "@/lib/assets";
import { normalizeIban } from "@/lib/iban";
import { getErrorMessage } from "@/lib/errors";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tryAmount = Number(body?.tryAmount);
  const iban = normalizeIban(String(body?.iban ?? ""));
  const loanId = body?.loanId as string | undefined;
  if (!Number.isFinite(tryAmount) || tryAmount <= 0) {
    return NextResponse.json({ error: "Missing or invalid 'tryAmount'" }, { status: 400 });
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

    const withdraw = await startSep6Withdraw({
      jwt: session.jwt,
      account: session.publicKey,
      assetCode: "USDC",
      // Matches the deposit-side fix: this anchor reads `amount` as the
      // fiat (TRY) amount, not the on-chain USDC amount from the quote.
      amount: String(tryAmount),
      quoteId: quote.id,
      dest: iban,
    });

    const borrowerId = await getOrCreateProfileId(session.publicKey);
    const supabase = getSupabaseServiceClient();
    const { data: row, error } = await supabase
      .from("withdrawals")
      .insert({
        borrower_id: borrowerId,
        loan_id: loanId ?? null,
        try_amount: tryAmount,
        usdc_amount: Number(quote.sell_amount),
        iban,
        anchor_ref: withdraw.id,
        status: "pending",
        // Recorded here so the payout step reads the destination from our own row rather
        // than from whatever the browser hands back.
        anchor_account: withdraw.account_id,
        anchor_memo: withdraw.memo ?? null,
        anchor_memo_type: withdraw.memo_type ?? null,
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ withdrawal: row, quote });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to start withdrawal") },
      { status: 502 },
    );
  }
}
