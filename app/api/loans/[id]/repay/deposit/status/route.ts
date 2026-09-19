import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSep6Transaction } from "@/lib/anchor";
import { getErrorMessage } from "@/lib/errors";

/** Polls the anchor transaction started by /repay/deposit until the USDC arrives. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  await params;

  const anchorRef = req.nextUrl.searchParams.get("anchorRef");
  if (!anchorRef) {
    return NextResponse.json({ error: "Missing 'anchorRef' query param" }, { status: 400 });
  }

  try {
    const anchorTx = await getSep6Transaction(session.jwt, anchorRef);
    return NextResponse.json({
      status: anchorTx.status,
      usdcAmount: anchorTx.amount_out ? Number(anchorTx.amount_out) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to fetch repayment deposit status") },
      { status: 502 },
    );
  }
}
