import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { advanceId, registryEnabled } from "@/lib/registry";
import { submitSignedTransaction } from "@/lib/blend";
import { requireEnv } from "@/lib/env";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { assertRegistryMarkRepaid, TransactionMismatchError } from "@/lib/txguard";
import { audit } from "@/lib/audit";
import { recordTransaction } from "@/lib/txlog";
import { getErrorMessage } from "@/lib/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!registryEnabled()) {
    return NextResponse.json({ error: "Registry feature is not configured" }, { status: 404 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id: loanId } = await params;
  const body = await req.json().catch(() => null);
  const signedXdr = body?.signedXdr as string | undefined;
  if (!signedXdr) {
    return NextResponse.json({ error: "Missing 'signedXdr'" }, { status: 400 });
  }

  try {
    const borrowerId = await getOrCreateProfileId(session.publicKey);
    const { data: withdrawal, error } = await getSupabaseServiceClient()
      .from("withdrawals")
      .select("id")
      .eq("loan_id", loanId)
      .eq("borrower_id", borrowerId)
      .maybeSingle();
    if (error) throw error;
    if (!withdrawal) {
      return NextResponse.json({ error: "Loan not found or no advance record" }, { status: 404 });
    }

    const id = advanceId(withdrawal.id);

    assertRegistryMarkRepaid(signedXdr, session.publicKey, {
      registryId: requireEnv("NEXT_PUBLIC_ADVANCE_REGISTRY_ID"),
      borrower: session.publicKey,
      id: id.toString("hex"),
    });

    const { hash } = await submitSignedTransaction(signedXdr);

    // Cache the close hash on the loan row.
    const { error: updateErr } = await getSupabaseServiceClient()
      .from("loans")
      .update({ registry_closed_tx: hash })
      .eq("id", loanId)
      .eq("borrower_id", borrowerId);
    if (updateErr) throw updateErr;

    await recordTransaction(session.publicKey, "registry_close", hash, { table: "loans", id: loanId });
    await audit("registry_close_submitted", session.publicKey, "ok", { loanId, hash });

    return NextResponse.json({ hash });
  } catch (err) {
    if (err instanceof TransactionMismatchError) {
      await audit("registry_close_submitted", session.publicKey, "rejected", {
        loanId,
        reason: err.message,
      });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to submit mark_repaid transaction") },
      { status: 502 },
    );
  }
}
