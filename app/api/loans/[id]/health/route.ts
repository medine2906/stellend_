import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUserPoolPosition } from "@/lib/blend";
import { getErrorMessage } from "@/lib/errors";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // `id` is accepted for routing symmetry with the other /api/loans/[id]/*
  // endpoints; health is read directly from the pool for the caller's own
  // wallet rather than looked up by our off-chain loan id.
  await params;

  try {
    const health = await getUserPoolPosition(session.publicKey);
    return NextResponse.json({ health });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to fetch collateral health") },
      { status: 502 },
    );
  }
}
