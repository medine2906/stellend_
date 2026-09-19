import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUserUsdcPosition } from "@/lib/blend";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { staleLoanIds, summarizeProfile } from "@/lib/profile";
import { getErrorMessage } from "@/lib/errors";

/** The signed-in user's deposits, loans and live pool balances, plus interest earned/owed. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const profileId = await getOrCreateProfileId(session.publicKey);
    const supabase = getSupabaseServiceClient();
    const [deposits, loans, position] = await Promise.all([
      supabase.from("deposits").select().eq("lender_id", profileId).order("created_at", { ascending: false }),
      supabase.from("loans").select().eq("borrower_id", profileId).order("created_at", { ascending: false }),
      getUserUsdcPosition(session.publicKey),
    ]);
    if (deposits.error) throw deposits.error;
    if (loans.error) throw loans.error;

    // Loans whose debt is already gone on-chain are marked repaid so they stop showing as open.
    const stale = staleLoanIds(loans.data, position.borrowed);
    if (stale.length > 0) {
      const { error } = await supabase.from("loans").update({ status: "repaid" }).in("id", stale).eq("borrower_id", profileId);
      if (error) throw error;
      for (const l of loans.data) if (stale.includes(l.id)) l.status = "repaid";
    }

    return NextResponse.json({
      publicKey: session.publicKey,
      summary: summarizeProfile(deposits.data, loans.data, position.supplied, position.borrowed),
      deposits: deposits.data,
      loans: loans.data,
    });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err, "Failed to load profile") }, { status: 502 });
  }
}
