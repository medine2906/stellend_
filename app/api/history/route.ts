import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

export interface HistoryEntry {
  kind: "deposit" | "withdrawal" | "loan";
  id: string;
  try_amount: number;
  status: string;
  created_at: string;
}

export interface ChainTxEntry {
  id: string;
  kind: string;
  hash: string;
  created_at: string;
}

/** Combined, chronological history of the signed-in user's deposits, withdrawals, and loans. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const profileId = await getOrCreateProfileId(session.publicKey);
    const supabase = getSupabaseServiceClient();

    const [deposits, withdrawals, loans, txLog] = await Promise.all([
      supabase.from("deposits").select().eq("lender_id", profileId),
      supabase.from("withdrawals").select().eq("borrower_id", profileId),
      supabase.from("loans").select().eq("borrower_id", profileId),
      supabase.from("transactions_log").select().eq("profile_id", profileId),
    ]);
    if (deposits.error) throw deposits.error;
    if (withdrawals.error) throw withdrawals.error;
    if (loans.error) throw loans.error;
    if (txLog.error) throw txLog.error;

    const entries: HistoryEntry[] = [
      ...deposits.data.map((d) => ({
        kind: "deposit" as const,
        id: d.id,
        try_amount: d.try_amount,
        status: d.status,
        created_at: d.created_at,
      })),
      ...withdrawals.data.map((w) => ({
        kind: "withdrawal" as const,
        id: w.id,
        try_amount: w.try_amount,
        status: w.status,
        created_at: w.created_at,
      })),
      ...loans.data.map((l) => ({
        kind: "loan" as const,
        id: l.id,
        try_amount: l.try_amount,
        status: l.status,
        created_at: l.created_at,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const transactions: ChainTxEntry[] = txLog.data
      .flatMap((t) => {
        const hash = (t.detail as { hash?: string } | null)?.hash;
        return hash ? [{ id: t.id, kind: t.kind, hash, created_at: t.created_at }] : [];
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json({ entries, transactions });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to fetch history") },
      { status: 502 },
    );
  }
}
