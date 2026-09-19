import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { buildTrIban } from "@/lib/iban";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

/** A sandbox IBAN has to pass the same checksum validation the borrow flow applies to real ones. */
const newSandboxIban = () => buildTrIban(digits(22));

/** The sandbox bank account linked to the signed-in wallet, or `{ account: null }`. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("profiles")
      .select("sandbox_iban, sandbox_holder, sandbox_created_at")
      .eq("stellar_public_key", session.publicKey)
      .maybeSingle();
    if (error) throw error;
    const account = data?.sandbox_iban
      ? { iban: data.sandbox_iban, holder: data.sandbox_holder ?? "Sandbox User", createdAt: data.sandbox_created_at ?? new Date().toISOString() }
      : null;
    return NextResponse.json({ account });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err, "Failed to load sandbox account") }, { status: 502 });
  }
}

/** Opens (or returns the existing) sandbox account with a freshly generated mock IBAN. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const holder = String(body?.holder ?? "").trim().slice(0, 80) || "Sandbox User";
  try {
    const profileId = await getOrCreateProfileId(session.publicKey);
    const supabase = getSupabaseServiceClient();
    const { data: existing, error: selectError } = await supabase
      .from("profiles").select("sandbox_iban, sandbox_holder, sandbox_created_at").eq("id", profileId).single();
    if (selectError) throw selectError;
    if (existing.sandbox_iban) {
      return NextResponse.json({
        account: { iban: existing.sandbox_iban, holder: existing.sandbox_holder ?? holder, createdAt: existing.sandbox_created_at },
      });
    }
    const account = {
      iban: newSandboxIban(),
      holder,
      createdAt: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("profiles")
      .update({ sandbox_iban: account.iban, sandbox_holder: account.holder, sandbox_created_at: account.createdAt })
      .eq("id", profileId);
    if (error) throw error;
    return NextResponse.json({ account });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err, "Failed to open sandbox account") }, { status: 502 });
  }
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { error } = await getSupabaseServiceClient()
      .from("profiles")
      .update({ sandbox_iban: null, sandbox_holder: null, sandbox_created_at: null })
      .eq("stellar_public_key", session.publicKey);
    if (error) throw error;
    return NextResponse.json({ account: null });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err, "Failed to close sandbox account") }, { status: 502 });
  }
}
