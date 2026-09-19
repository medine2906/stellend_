import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { RequestType } from "@blend-capital/blend-sdk";
import { submitSignedTransaction } from "@/lib/blend";
import { requireEnv } from "@/lib/env";
import { assertPoolRequest, TransactionMismatchError } from "@/lib/txguard";
import { recordTransaction } from "@/lib/txlog";
import { getErrorMessage } from "@/lib/errors";

/** Lender: submits the signed Blend `Withdraw` transaction. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const signedXdr = body?.signedXdr as string | undefined;
  if (!signedXdr) {
    return NextResponse.json({ error: "Missing 'signedXdr'" }, { status: 400 });
  }

  try {
    // A lender can withdraw whatever the pool lets them, so only the action is pinned.
    assertPoolRequest(signedXdr, session.publicKey, requireEnv("NEXT_PUBLIC_BLEND_POOL_ID"), {
      requestType: RequestType.Withdraw,
      asset: requireEnv("NEXT_PUBLIC_USDC_CONTRACT_ID"),
    });

    const { hash } = await submitSignedTransaction(signedXdr);
    await recordTransaction(session.publicKey, "pool_withdraw", hash);
    return NextResponse.json({ hash });
  } catch (err) {
    if (err instanceof TransactionMismatchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to submit withdraw transaction") },
      { status: 502 },
    );
  }
}
