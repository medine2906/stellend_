import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSep6Transaction } from "@/lib/anchor";
import { getSupabaseServiceClient } from "@/lib/supabase";
import type { WithdrawalStatus } from "@/lib/database.types";
import { getErrorMessage } from "@/lib/errors";

function mapAnchorStatus(status: string): WithdrawalStatus {
  if (status === "completed") return "completed";
  if (status === "error" || status === "expired" || status === "refunded") return "failed";
  if (status === "pending_user_transfer_start") return "pending";
  return "processing";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: withdrawal, error } = await supabase.from("withdrawals").select().eq("id", id).single();
  if (error || !withdrawal) {
    return NextResponse.json({ error: "Withdrawal not found" }, { status: 404 });
  }

  try {
    const anchorTx = await getSep6Transaction(session.jwt, withdrawal.anchor_ref);
    const status = mapAnchorStatus(anchorTx.status);

    if (status !== withdrawal.status) {
      await supabase.from("withdrawals").update({ status }).eq("id", id);
    }

    // A cash-advance loan only becomes active once the TRY has actually been paid out.
    if (status === "completed" && withdrawal.loan_id) {
      await supabase.from("loans").update({ status: "active" }).eq("id", withdrawal.loan_id).eq("status", "pending");
    }

    return NextResponse.json({ withdrawal: { ...withdrawal, status }, anchorTransaction: anchorTx });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to fetch withdrawal status") },
      { status: 502 },
    );
  }
}
