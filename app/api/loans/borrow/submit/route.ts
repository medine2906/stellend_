import { NextRequest, NextResponse } from "next/server";
import { RequestType } from "@blend-capital/blend-sdk";
import { getSession } from "@/lib/session";
import { submitSignedTransaction } from "@/lib/blend";
import { loadWithdrawalIntent } from "@/lib/borrowIntent";
import { requireEnv } from "@/lib/env";
import { getOrCreateProfileId } from "@/lib/profiles";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { assertPoolRequest, toFixedAmount, TransactionMismatchError } from "@/lib/txguard";
import { audit } from "@/lib/audit";
import { recordTransaction } from "@/lib/txlog";
import { getErrorMessage } from "@/lib/errors";
import { dueDateFrom } from "@/lib/liquidity";

/** Rounding between the quote, the pool's fixed-point maths and Blend itself; one cent of USDC. */
const AMOUNT_TOLERANCE_USDC = 0.01;

export async function POST(req: NextRequest) {
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
    // Every figure below comes from the intent reserved before the chain was touched,
    // so the loan on record is the loan that exists on-chain.
    const intent = await loadWithdrawalIntent(withdrawalId, session.publicKey);
    if (!intent) return NextResponse.json({ error: "Cash advance not found" }, { status: 404 });
    if (intent.loan_id || intent.borrow_tx) {
      return NextResponse.json({ error: "This advance has already been borrowed" }, { status: 409 });
    }
    if (!intent.collateral_tx || !intent.collateral_asset || intent.collateral_amount == null) {
      return NextResponse.json({ error: "Collateral must be locked before borrowing" }, { status: 409 });
    }

    assertPoolRequest(signedXdr, session.publicKey, requireEnv("NEXT_PUBLIC_BLEND_POOL_ID"), {
      requestType: RequestType.Borrow,
      asset: requireEnv("NEXT_PUBLIC_USDC_CONTRACT_ID"),
      // Borrowing more than was quoted would leave debt the loan record does not show.
      maxAmount: toFixedAmount(intent.usdc_amount + AMOUNT_TOLERANCE_USDC),
    });

    const { hash } = await submitSignedTransaction(signedXdr);

    const borrowerId = await getOrCreateProfileId(session.publicKey);
    const supabase = getSupabaseServiceClient();
    // The loan stays 'pending' until the anchor has paid out the TRY; the
    // withdrawal status route flips it to 'active' on completion.
    const { data: loan, error: loanError } = await supabase
      .from("loans")
      .insert({
        borrower_id: borrowerId,
        collateral_asset: intent.collateral_asset,
        collateral_amount: intent.collateral_amount,
        borrowed_usdc_amount: intent.usdc_amount,
        try_amount: intent.try_amount,
        status: "pending",
        due_at: dueDateFrom(new Date()).toISOString(),
      })
      .select()
      .single();
    if (loanError) throw loanError;

    const { error: linkError } = await supabase
      .from("withdrawals")
      .update({ loan_id: loan.id, borrow_tx: hash })
      .eq("id", withdrawalId);
    if (linkError) throw linkError;

    await recordTransaction(session.publicKey, "borrow", hash, { table: "loans", id: loan.id });
    await audit("borrow_submitted", session.publicKey, "ok", { withdrawalId, loanId: loan.id, usdcAmount: intent.usdc_amount, hash });
    return NextResponse.json({ loan, hash });
  } catch (err) {
    if (err instanceof TransactionMismatchError) {
      await audit("borrow_submitted", session.publicKey, "rejected", { withdrawalId, reason: err.message });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to finalize loan") },
      { status: 502 },
    );
  }
}
