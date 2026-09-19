import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { loadWithdrawalIntent } from "@/lib/borrowIntent";
import { advanceId, payoutRef, usdcToStroops, tryToMinorUnits, registryEnabled } from "@/lib/registry";
import { submitSignedTransaction } from "@/lib/blend";
import { requireEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { assertRegistryOpen, TransactionMismatchError } from "@/lib/txguard";
import { audit } from "@/lib/audit";
import { recordTransaction } from "@/lib/txlog";
import { getErrorMessage } from "@/lib/errors";

export async function POST(req: NextRequest) {
  if (!registryEnabled()) {
    return NextResponse.json({ error: "Registry feature is not configured" }, { status: 404 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const signedXdr = body?.signedXdr as string | undefined;
  const withdrawalId = body?.withdrawalId as string | undefined;
  if (!signedXdr || !withdrawalId) {
    return NextResponse.json({ error: "Missing 'signedXdr' or 'withdrawalId'" }, { status: 400 });
  }

  try {
    const intent = await loadWithdrawalIntent(withdrawalId, session.publicKey);
    if (!intent) return NextResponse.json({ error: "Cash advance not found" }, { status: 404 });
    if (!intent.payout_tx) {
      return NextResponse.json(
        { error: "The payout has not landed yet — nothing to record" },
        { status: 409 },
      );
    }
    if (!intent.loan_id) {
      return NextResponse.json({ error: "This advance has no associated loan record" }, { status: 409 });
    }

    const { data: loan, error: loanErr } = await getSupabaseServiceClient()
      .from("loans")
      .select("due_at")
      .eq("id", intent.loan_id)
      .maybeSingle();
    if (loanErr) throw loanErr;
    if (!loan?.due_at) {
      return NextResponse.json({ error: "Loan has no due date on record" }, { status: 409 });
    }
    const dueAtSec = BigInt(Math.floor(new Date(loan.due_at).getTime() / 1000));

    // Guard: every argument is server-derived, so every check is equality.
    const id = advanceId(withdrawalId);
    const ref = payoutRef(intent.anchor_ref, intent.iban);

    assertRegistryOpen(signedXdr, session.publicKey, {
      registryId: requireEnv("NEXT_PUBLIC_ADVANCE_REGISTRY_ID"),
      borrower: session.publicKey,
      id: id.toString("hex"),
      payoutRef: ref.toString("hex"),
      usdcStroops: usdcToStroops(intent.usdc_amount),
      tryMinorUnits: tryToMinorUnits(intent.try_amount),
      dueAtSec,
    });

    const { hash } = await submitSignedTransaction(signedXdr);

    // Cache the result. AlreadyExists on a retry would not reach here (it would throw
    // before submit), but if it did, the guard would have accepted it, so the hash
    // update is correct either way.
    const { error: updateErr } = await getSupabaseServiceClient()
      .from("withdrawals")
      .update({
        advance_id: id.toString("hex"),
        registry_tx: hash,
      })
      .eq("id", withdrawalId);
    if (updateErr) throw updateErr;

    await recordTransaction(session.publicKey, "registry_open", hash, { table: "withdrawals", id: withdrawalId });
    await audit("registry_open_submitted", session.publicKey, "ok", { withdrawalId, hash });

    return NextResponse.json({ hash });
  } catch (err) {
    if (err instanceof TransactionMismatchError) {
      await audit("registry_open_submitted", session.publicKey, "rejected", {
        withdrawalId,
        reason: err.message,
      });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to submit registry transaction") },
      { status: 502 },
    );
  }
}
