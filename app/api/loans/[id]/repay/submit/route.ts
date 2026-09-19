import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { RequestType } from "@blend-capital/blend-sdk";
import { getUserUsdcPosition, submitSignedTransaction } from "@/lib/blend";
import { requireEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getOrCreateProfileId } from "@/lib/profiles";
import { assertPoolRequest, TransactionMismatchError } from "@/lib/txguard";
import { recordTransaction } from "@/lib/txlog";
import { getErrorMessage } from "@/lib/errors";

/** Interest accrues per ledger, so a full repayment leaves a sub-cent remainder behind. */
const DUST_USDC = 0.01;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const signedXdr = body?.signedXdr as string | undefined;
  if (!signedXdr) {
    return NextResponse.json({ error: "Missing 'signedXdr'" }, { status: 400 });
  }

  try {
    assertPoolRequest(signedXdr, session.publicKey, requireEnv("NEXT_PUBLIC_BLEND_POOL_ID"), {
      requestType: RequestType.Repay,
      asset: requireEnv("NEXT_PUBLIC_USDC_CONTRACT_ID"),
    });

    const { hash } = await submitSignedTransaction(signedXdr);

    // Whether the debt is gone is read from the pool afterwards, not claimed by the
    // caller: marking a loan repaid while debt remains would hide it from the keeper.
    const { borrowed } = await getUserUsdcPosition(session.publicKey);
    const fullyRepaid = borrowed < DUST_USDC;

    const supabase = getSupabaseServiceClient();
    // A bulk repayment settles several loans with one transaction; the Blend debt is per wallet.
    const settleIds = Array.from(new Set([id, ...(Array.isArray(body?.settledLoanIds) ? (body.settledLoanIds as string[]) : [])]));
    const borrowerId = await getOrCreateProfileId(session.publicKey);
    const { data: loans, error } = await supabase
      .from("loans")
      .update({ status: fullyRepaid ? "repaid" : "active" })
      .in("id", settleIds)
      .eq("borrower_id", borrowerId)
      .select();
    if (error) throw error;

    await recordTransaction(session.publicKey, "repay", hash, { table: "loans", id });

    return NextResponse.json({ hash, fullyRepaid, loan: loans[0] ?? null, loans });
  } catch (err) {
    if (err instanceof TransactionMismatchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to submit repayment") },
      { status: 502 },
    );
  }
}
