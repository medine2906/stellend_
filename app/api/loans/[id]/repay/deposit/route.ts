import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertWithinSep6Limits, getSep38Quote, simulateSep6BankTransfer, startSep6Deposit } from "@/lib/anchor";
import { MIN_DEPOSIT_TRY, TRY_SEP38_ASSET, usdcSep38Asset } from "@/lib/assets";
import { env } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";

/**
 * Borrower: converts a TRY repayment amount into USDC via the anchor
 * (mirrors the lender deposit flow) so the borrower's wallet receives the
 * USDC needed to repay the Blend loan. Returns bank instructions plus the
 * anchor transaction id to poll for completion.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  await params;

  const body = await req.json().catch(() => null);
  const tryAmount = body?.tryAmount as number | undefined;
  if (!tryAmount || tryAmount <= 0) {
    return NextResponse.json({ error: "Missing or invalid 'tryAmount'" }, { status: 400 });
  }

  if (tryAmount < MIN_DEPOSIT_TRY) {
    return NextResponse.json({ error: `Amount must be at least ${MIN_DEPOSIT_TRY} TRY` }, { status: 400 });
  }

  try {
    await assertWithinSep6Limits("deposit", "USDC", tryAmount);

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
      amount: String(tryAmount),
      quoteId: quote.id,
    });

    // The mock anchor only pays out USDC once it is told the bank transfer
    // arrived. Nobody can make a real transfer in the sandbox, so play the bank
    // here; on a real network the transfer itself moves the deposit forward.
    if (env.NEXT_PUBLIC_STELLAR_NETWORK === "TESTNET") {
      await simulateSep6BankTransfer(session.jwt, deposit.id, tryAmount);
    }

    return NextResponse.json({
      anchorRef: deposit.id,
      usdcAmount: Number(quote.buy_amount),
      instructions: deposit.instructions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to start repayment deposit") },
      { status: 502 },
    );
  }
}
