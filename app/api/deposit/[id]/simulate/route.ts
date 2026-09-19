import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { simulateSep6BankTransfer } from "@/lib/anchor";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { env } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";

/** Sandbox only: plays the bank, telling the mock anchor the user's TRY transfer arrived. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (env.NEXT_PUBLIC_STELLAR_NETWORK !== "TESTNET") {
    return NextResponse.json({ error: "Bank transfer simulation is testnet-only" }, { status: 403 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseServiceClient();
  const { data: deposit, error } = await supabase.from("deposits").select().eq("id", id).single();
  if (error || !deposit) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }

  try {
    await simulateSep6BankTransfer(session.jwt, deposit.anchor_ref, deposit.try_amount);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err, "Failed to simulate bank transfer") }, { status: 502 });
  }
}
