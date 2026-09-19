import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSep38Quote } from "@/lib/anchor";
import { MIN_DEPOSIT_TRY, TRY_SEP38_ASSET, usdcSep38Asset } from "@/lib/assets";
import { getErrorMessage } from "@/lib/errors";

/** Anchor-sourced preview of a TRY -> USDC deposit (price, fee, USDC received) before the user commits. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tryAmount = Number(body?.tryAmount);
  if (!(tryAmount > 0)) {
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
    return NextResponse.json({ quote });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err, "Failed to get quote") }, { status: 502 });
  }
}
