import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

/** Earlier spends from the sandbox account, newest first. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const profileId = await getOrCreateProfileId(session.publicKey);
    const { data, error } = await getSupabaseServiceClient()
      .from("sandbox_spends").select().eq("profile_id", profileId).order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ spends: data });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err, "Failed to load spends") }, { status: 502 });
  }
}

/** Spends money from the sandbox bank account. The balance is advances received minus earlier spends. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const amount = Math.round(Number(body?.amount) * 100) / 100;
  const description = String(body?.description ?? "").trim().slice(0, 120);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than 0" }, { status: 400 });
  }

  try {
    const profileId = await getOrCreateProfileId(session.publicKey);
    const supabase = getSupabaseServiceClient();
    const [loans, spends] = await Promise.all([
      supabase.from("loans").select("try_amount").eq("borrower_id", profileId).neq("status", "pending"),
      supabase.from("sandbox_spends").select("amount").eq("profile_id", profileId),
    ]);
    if (loans.error) throw loans.error;
    if (spends.error) throw spends.error;

    const received = loans.data.reduce((s, l) => s + Number(l.try_amount), 0);
    const spent = spends.data.reduce((s, r) => s + Number(r.amount), 0);
    const balance = received - spent;
    if (amount > balance + 0.005) {
      return NextResponse.json({ error: `Not enough balance. Available: ${balance.toFixed(2)} TRY` }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("sandbox_spends")
      .insert({ profile_id: profileId, amount, description })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ spend: data });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err, "Failed to spend") }, { status: 502 });
  }
}
