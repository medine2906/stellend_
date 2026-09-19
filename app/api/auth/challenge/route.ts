import { NextRequest, NextResponse } from "next/server";
import { requestSep10Challenge } from "@/lib/anchor";
import { getErrorMessage } from "@/lib/errors";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const account = body?.account as string | undefined;

  if (!account) {
    return NextResponse.json({ error: "Missing 'account' (Stellar public key)" }, { status: 400 });
  }

  try {
    const challenge = await requestSep10Challenge(account);
    return NextResponse.json(challenge);
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to fetch SEP-10 challenge") },
      { status: 502 },
    );
  }
}
