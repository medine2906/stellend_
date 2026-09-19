import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { repayBorrow, RestoreRequiredError } from "@/lib/blend";
import { getErrorMessage } from "@/lib/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  await params;

  const body = await req.json().catch(() => null);
  const usdcAmount = body?.usdcAmount as number | undefined;
  if (!usdcAmount || usdcAmount <= 0) {
    return NextResponse.json({ error: "Missing or invalid 'usdcAmount'" }, { status: 400 });
  }

  try {
    const unsignedXdr = await repayBorrow(session.publicKey, usdcAmount);
    return NextResponse.json({ unsignedXdr });
  } catch (err) {
    if (err instanceof RestoreRequiredError) {
      return NextResponse.json({ needsRestore: true, restoreXdr: err.restoreXdr });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to prepare repay transaction") },
      { status: 502 },
    );
  }
}
