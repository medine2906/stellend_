import { NextRequest, NextResponse } from "next/server";
import { submitSep10Challenge } from "@/lib/anchor";
import { audit } from "@/lib/audit";
import { assertSessionMatchesToken, Sep10MismatchError } from "@/lib/sep10";
import { setSessionCookie } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const transaction = body?.transaction as string | undefined;
  const claimedPublicKey = body?.publicKey as string | undefined;

  if (!transaction || !claimedPublicKey) {
    return NextResponse.json({ error: "Missing 'transaction' or 'publicKey'" }, { status: 400 });
  }

  let jwt: string;
  try {
    ({ token: jwt } = await submitSep10Challenge(transaction));
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to exchange SEP-10 challenge") },
      { status: 502 },
    );
  }

  // The session's identity comes from the anchor's token, not the request body: a valid
  // challenge signed with one's own key must never open a session for another account.
  let publicKey: string;
  try {
    publicKey = assertSessionMatchesToken(claimedPublicKey, jwt, transaction);
  } catch (err) {
    if (err instanceof Sep10MismatchError) {
      // Worth a trail of its own: this is what an attempt to log in as someone else looks like.
      await audit("login", claimedPublicKey, "rejected", { reason: err.message });
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  try {
    await setSessionCookie({ jwt, publicKey });
  } catch (err) {
    // Typically a missing or too-short SESSION_COOKIE_SECRET in production. Without this the
    // route dies with an empty 500 and the browser reports "Unexpected end of JSON input".
    console.error("[auth] failed to set session cookie", err);
    return NextResponse.json(
      { error: getErrorMessage(err, "Could not start a session (server misconfigured)") },
      { status: 500 },
    );
  }

  let profileSynced = true;
  try {
    const supabase = getSupabaseServiceClient();
    await supabase.from("profiles").upsert(
      { stellar_public_key: publicKey },
      { onConflict: "stellar_public_key" },
    );
  } catch {
    // Supabase may not be provisioned in every environment yet; the SEP-10
    // session is still valid without the off-chain profile cache.
    profileSynced = false;
  }

  await audit("login", publicKey, "ok", { profileSynced });
  return NextResponse.json({ success: true, publicKey, profileSynced });
}
