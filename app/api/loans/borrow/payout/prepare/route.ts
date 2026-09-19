import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { buildUsdcPaymentTransaction } from "@/lib/blend";
import { ensureAnchorDestination, loadWithdrawalIntent } from "@/lib/borrowIntent";
import { getErrorMessage } from "@/lib/errors";

/**
 * Builds the payment that hands the borrowed USDC to the anchor. Destination, memo and
 * amount all come from the withdrawal the anchor itself issued — a client-supplied
 * destination here would be a way to route someone's borrowed funds elsewhere.
 */
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
    const loaded = await loadWithdrawalIntent(withdrawalId, session.publicKey);
    if (!loaded) return NextResponse.json({ error: "Cash advance not found" }, { status: 404 });
    const intent = await ensureAnchorDestination(loaded, session.jwt);
    if (!intent.anchor_account) {
      return NextResponse.json({ error: "This advance has no anchor destination on record" }, { status: 409 });
    }

    const unsignedXdr = await buildUsdcPaymentTransaction(
      session.publicKey,
      intent.anchor_account,
      intent.usdc_amount,
      (intent.anchor_memo_type as "text" | "id" | "hash" | null) ?? undefined,
      intent.anchor_memo ?? undefined,
    );
    return NextResponse.json({ unsignedXdr });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to prepare payout transaction") },
      { status: 502 },
    );
  }
}
