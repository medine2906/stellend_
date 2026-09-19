import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { borrowStage } from "@/lib/borrowIntent";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

/** How long an untouched, unfinished advance is still offered for resuming. */
const RESUMABLE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A cash advance is four signed transactions, and a closed tab between any two of them
 * leaves the borrower mid-flow — worst case holding borrowed USDC with no TRY coming.
 * This reports the unfinished advance, if there is one, and which step it stopped at,
 * so the UI can pick the flow back up instead of starting a second one.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const borrowerId = await getOrCreateProfileId(session.publicKey);
    const cutoff = new Date(Date.now() - RESUMABLE_WINDOW_MS).toISOString();

    const { data: rows, error } = await getSupabaseServiceClient()
      .from("withdrawals")
      .select()
      .eq("borrower_id", borrowerId)
      .in("status", ["pending", "processing"])
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;

    const intent = rows?.[0];
    if (!intent) return NextResponse.json({ pending: null });

    const stage = borrowStage(intent);
    if (stage === "done") return NextResponse.json({ pending: null });

    return NextResponse.json({
      pending: {
        withdrawalId: intent.id,
        stage,
        tryAmount: intent.try_amount,
        usdcAmount: intent.usdc_amount,
        iban: intent.iban,
        collateralAsset: intent.collateral_asset,
        collateralAmount: intent.collateral_amount,
        createdAt: intent.created_at,
        txs: [
          intent.collateral_tx && { label: "Lock collateral", hash: intent.collateral_tx },
          intent.borrow_tx && { label: "Borrow USDC", hash: intent.borrow_tx },
          intent.payout_tx && { label: "Send USDC to anchor", hash: intent.payout_tx },
        ].filter(Boolean),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to look up unfinished cash advances") },
      { status: 502 },
    );
  }
}

/** Abandons an unfinished advance so the borrower can start a fresh one. */
export async function DELETE(req: Request) {
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
    const borrowerId = await getOrCreateProfileId(session.publicKey);
    // Only an advance that never reached the chain can simply be dropped; once collateral
    // is locked the borrower has to finish or unwind it, which the flow itself handles.
    const { data, error } = await getSupabaseServiceClient()
      .from("withdrawals")
      .update({ status: "failed" })
      .eq("id", withdrawalId)
      .eq("borrower_id", borrowerId)
      .is("collateral_tx", null)
      .select();
    if (error) throw error;
    if (!data?.length) {
      return NextResponse.json({ error: "This advance has already moved on-chain and cannot be discarded" }, { status: 409 });
    }
    return NextResponse.json({ discarded: true });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to discard the unfinished advance") },
      { status: 502 },
    );
  }
}
