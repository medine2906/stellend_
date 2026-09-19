import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ensureUsdcTrustline } from "@/lib/blend";
import { getErrorMessage } from "@/lib/errors";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const unsignedXdr = await ensureUsdcTrustline(session.publicKey);
    if (!unsignedXdr) {
      return NextResponse.json({ needed: false });
    }
    return NextResponse.json({ needed: true, unsignedXdr });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to check/prepare USDC trustline") },
      { status: 502 },
    );
  }
}
