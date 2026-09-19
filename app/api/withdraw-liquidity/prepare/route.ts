import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPoolUsdcLiquidity, withdrawLiquidity, RestoreRequiredError } from "@/lib/blend";
import { idleLiquidity } from "@/lib/liquidity";
import { getErrorMessage } from "@/lib/errors";

/**
 * Lender: prepares the Blend `Withdraw` transaction for `usdcAmount`, capped to
 * the pool's idle (not lent out) USDC. The lender's wallet signs the returned XDR.
 * GET returns how much can be withdrawn right now.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { totalSupplied, totalBorrowed } = await getPoolUsdcLiquidity();
    return NextResponse.json({ withdrawableNow: idleLiquidity(totalSupplied, totalBorrowed) });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err, "Failed to read pool liquidity") }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const usdcAmount = body?.usdcAmount as number | undefined;
  if (!usdcAmount || usdcAmount <= 0) {
    return NextResponse.json({ error: "Missing or invalid 'usdcAmount'" }, { status: 400 });
  }

  try {
    const { totalSupplied, totalBorrowed } = await getPoolUsdcLiquidity();
    const available = idleLiquidity(totalSupplied, totalBorrowed);
    if (usdcAmount > available) {
      return NextResponse.json(
        { error: `Only ${available.toFixed(2)} USDC is available to withdraw right now; the rest is lent out`, available },
        { status: 409 },
      );
    }

    const unsignedXdr = await withdrawLiquidity(session.publicKey, usdcAmount);
    return NextResponse.json({ unsignedXdr });
  } catch (err) {
    if (err instanceof RestoreRequiredError) {
      return NextResponse.json({ needsRestore: true, restoreXdr: err.restoreXdr });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to prepare withdraw transaction") },
      { status: 502 },
    );
  }
}
