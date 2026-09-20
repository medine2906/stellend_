import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { loadWithdrawalIntent } from "@/lib/borrowIntent";
import { buildOpenTransaction } from "@/lib/registry";
import { registryEnabled } from "@/lib/registry";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

/**
 * Step 6 — prepare the advance registry `open` transaction.
 *
 * This is offered after payout lands, not required. A borrower who declines
 * (or closes the tab) can come back to it from the loan detail view;
 * nothing downstream checks for it.
 */
export async function POST(req: NextRequest) {
  if (!registryEnabled()) {
    return NextResponse.json({ error: "Registry feature is not configured" }, { status: 404 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const withdrawalId = body?.withdrawalId as string | undefined;
  if (!withdrawalId) {
    return NextResponse.json({ error: "Missing 'withdrawalId'" }, { status: 400 });
  }

  try {
    const intent = await loadWithdrawalIntent(withdrawalId, session.publicKey);
    if (!intent) return NextResponse.json({ error: "Cash advance not found" }, { status: 404 });

    // The advance must be past payout — there is nothing settled to sign before that.
    if (!intent.payout_tx) {
      return NextResponse.json(
        { error: "The payout has not landed yet — nothing to record" },
        { status: 409 },
      );
    }

    // Either column means the record is on chain; a second one cannot be written under the
    // same id, so there is nothing to sign.
    if (intent.registry_tx || intent.registry_recorded_at) {
      return NextResponse.json({ error: "This advance is already recorded on-chain" }, { status: 409 });
    }

    // Fetch due_at from the loan row so the on-chain value always matches what the UI shows.
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

    const dueAtUnix = Math.floor(new Date(loan.due_at).getTime() / 1000);

    // The contract stores a commitment, so it refuses a date that is not ahead of the
    // ledger. An advance whose target date has already gone by can never be recorded;
    // saying that here beats inviting a signature that fails with a bare contract error.
    if (dueAtUnix <= Math.floor(Date.now() / 1000)) {
      return NextResponse.json(
        {
          error:
            "The target close date on this advance has already passed, so it can no longer be recorded on-chain",
        },
        { status: 409 },
      );
    }

    const unsignedXdr = await buildOpenTransaction(session.publicKey, intent, dueAtUnix);
    return NextResponse.json({ unsignedXdr });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to prepare registry transaction") },
      { status: 502 },
    );
  }
}
