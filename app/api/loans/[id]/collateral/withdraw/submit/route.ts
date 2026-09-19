import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { RequestType } from "@blend-capital/blend-sdk";
import { submitSignedTransaction } from "@/lib/blend";
import { requireEnv } from "@/lib/env";
import { decodePoolSubmit, TransactionMismatchError } from "@/lib/txguard";
import { recordTransaction } from "@/lib/txlog";
import { getErrorMessage } from "@/lib/errors";

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
    // Releasing collateral only ever reduces the borrower's own position, so the
    // amount is theirs to choose; the action and the pool still have to be ours.
    const [request] = decodePoolSubmit(signedXdr, session.publicKey, requireEnv("NEXT_PUBLIC_BLEND_POOL_ID"));
    if (request?.requestType !== RequestType.WithdrawCollateral) {
      return NextResponse.json({ error: "This transaction does not release collateral" }, { status: 400 });
    }

    const { hash } = await submitSignedTransaction(signedXdr);
    await recordTransaction(session.publicKey, "collateral_release", hash, { table: "loans", id });
    return NextResponse.json({ hash });
  } catch (err) {
    if (err instanceof TransactionMismatchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to submit collateral release transaction") },
      { status: 502 },
    );
  }
}
