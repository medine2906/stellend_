import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSep6Transaction } from "@/lib/anchor";
import { getSupabaseServiceClient } from "@/lib/supabase";
import type { DepositStatus } from "@/lib/database.types";
import { getErrorMessage } from "@/lib/errors";

function mapAnchorStatus(status: string): DepositStatus {
  if (status === "completed") return "completed";
  if (status === "error" || status === "expired" || status === "refunded") return "failed";
  if (status === "pending_anchor" || status === "pending_stellar" || status === "pending_trust") {
    return "converting";
  }
  return "pending";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const anchorTx = await getSep6Transaction(session.jwt, deposit.anchor_ref);
    const status = mapAnchorStatus(anchorTx.status);

    if (status !== deposit.status) {
      await supabase
        .from("deposits")
        .update({
          status,
          usdc_amount: anchorTx.amount_out ? Number(anchorTx.amount_out) : deposit.usdc_amount,
        })
        .eq("id", id);
    }

    return NextResponse.json({ deposit: { ...deposit, status }, anchorTransaction: anchorTx });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to fetch deposit status") },
      { status: 502 },
    );
  }
}
