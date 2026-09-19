import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { assertWithinSep6Limits, getSep38Quote } from "@/lib/anchor";
import { TRY_SEP38_ASSET, usdcSep38Asset } from "@/lib/assets";
import { getErrorMessage } from "@/lib/errors";

/** Quotes the USDC needed to borrow (and cash out) a given TRY amount. */
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

  try {
    await assertWithinSep6Limits("withdraw", "USDC", tryAmount);

    const quote = await getSep38Quote({
      jwt: session.jwt,
      sellAsset: usdcSep38Asset(),
      buyAsset: TRY_SEP38_ASSET,
      buyAmount: String(tryAmount),
    });
    return NextResponse.json({ usdcAmount: Number(quote.sell_amount), quote });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to fetch quote") },
      { status: 502 },
    );
  }
}
