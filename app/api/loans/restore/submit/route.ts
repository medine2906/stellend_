import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { submitSignedTransaction } from "@/lib/blend";
import { assertRestoreFootprint, TransactionMismatchError } from "@/lib/txguard";
import { recordTransaction } from "@/lib/txlog";
import { getErrorMessage } from "@/lib/errors";

/** Submits a signed `restoreFootprint` transaction for expired ledger entries. */
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
    assertRestoreFootprint(signedXdr, session.publicKey);
    const { hash } = await submitSignedTransaction(signedXdr);
    await recordTransaction(session.publicKey, "restore", hash);
    return NextResponse.json({ hash });
  } catch (err) {
    if (err instanceof TransactionMismatchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to submit restore transaction") },
      { status: 502 },
    );
  }
}
