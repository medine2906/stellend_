import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { borrowAsset, getPoolUsdcLiquidity, RestoreRequiredError } from "@/lib/blend";
import { loadWithdrawalIntent } from "@/lib/borrowIntent";
import { exceedsUtilizationCap, maxBorrowable } from "@/lib/liquidity";
import { getErrorMessage } from "@/lib/errors";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const withdrawalId = body?.withdrawalId as string | undefined;
  if (!withdrawalId) {
    return NextResponse.json({ error: "Missing 'withdrawalId'" }, { status: 400 });
  }

  try {
    // The amount comes from the reserved withdrawal, not the request: the borrow must
    // match the cash-out it was quoted for.
    const intent = await loadWithdrawalIntent(withdrawalId, session.publicKey);
    if (!intent) return NextResponse.json({ error: "Cash advance not found" }, { status: 404 });
    const usdcAmount = intent.usdc_amount;

    const { totalSupplied, totalBorrowed } = await getPoolUsdcLiquidity();
    if (exceedsUtilizationCap(totalSupplied, totalBorrowed, usdcAmount)) {
      const max = maxBorrowable(totalSupplied, totalBorrowed);
      return NextResponse.json(
        { error: `Pool liquidity is limited right now; you can borrow at most ${max.toFixed(2)} USDC` },
        { status: 409 },
      );
    }

    const unsignedXdr = await borrowAsset(session.publicKey, usdcAmount);
    return NextResponse.json({ unsignedXdr, usdcAmount });
  } catch (err) {
    if (err instanceof RestoreRequiredError) {
      return NextResponse.json({ needsRestore: true, restoreXdr: err.restoreXdr });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to prepare borrow transaction") },
      { status: 502 },
    );
  }
}
