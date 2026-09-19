import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUserPoolPosition, getUserUsdcPosition } from "@/lib/blend";
import { dailyInterest, dropUntilLiquidation, positionRisk } from "@/lib/liquidity";
import { getOrCreateProfileId } from "@/lib/profiles";
import { registryEnabled } from "@/lib/registry";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";

/**
 * The signed-in borrower's own advances, most recent first, together with what their debt
 * is actually doing on-chain right now.
 *
 * The live figures are the point: Blend charges variable interest from the first ledger and
 * never stops, so what a borrower needs to see is what they owe today and what today costs —
 * not a target date that nothing enforces. Debt is tracked per wallet, not per loan, so it
 * is reported once for the position rather than split across rows.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const borrowerId = await getOrCreateProfileId(session.publicKey);
    const supabase = getSupabaseServiceClient();
    const { data: loans, error } = await supabase
      .from("loans")
      .select()
      .eq("borrower_id", borrowerId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    // The chain is slower and likelier to fail than the database; a stale rate must not
    // take the list down with it.
    const live = await Promise.all([
      getUserUsdcPosition(session.publicKey).catch(() => null),
      getUserPoolPosition(session.publicKey).catch(() => null),
    ]);
    const [position, health] = live;

    const principal = (loans ?? [])
      .filter((l) => l.status === "active" || l.status === "defaulted")
      .reduce((sum, l) => sum + l.borrowed_usdc_amount, 0);

    const debt =
      position == null
        ? null
        : {
            principalUsdc: principal,
            owedUsdc: position.borrowed,
            interestSoFarUsdc: Math.max(0, position.borrowed - principal),
            borrowApr: position.borrowApr,
            perDayUsdc: dailyInterest(position.borrowed, position.borrowApr),
          };

    const collateral =
      health == null
        ? null
        : {
            risk: positionRisk(health.totalEffectiveCollateral, health.totalEffectiveLiabilities),
            dropUntilLiquidation: dropUntilLiquidation(
              health.totalEffectiveCollateral,
              health.totalEffectiveLiabilities,
            ),
            effectiveCollateral: health.totalEffectiveCollateral,
            effectiveLiabilities: health.totalEffectiveLiabilities,
          };

    // Whether an advance has an on-chain receipt is recorded on its withdrawal row. Read as
    // its own query rather than an embedded select: the hand-written Database type declares
    // no relationships, so an embed comes back untyped.
    // The withdrawal id travels with the loan because the registry key is derived from it,
    // not from the loan id — without it the UI cannot offer to sign a record after the fact.
    const receipts = new Map<string, { withdrawalId: string; registryTx: string | null }>();
    const loanIds = (loans ?? []).map((l) => l.id);
    if (loanIds.length > 0) {
      const { data: withdrawals, error: receiptsError } = await supabase
        .from("withdrawals")
        .select("id, loan_id, registry_tx")
        .in("loan_id", loanIds);
      if (receiptsError) throw receiptsError;
      for (const w of withdrawals ?? []) {
        if (w.loan_id) receipts.set(w.loan_id, { withdrawalId: w.id, registryTx: w.registry_tx });
      }
    }

    const loansWithRegistry = (loans ?? []).map((loan) => {
      const receipt = receipts.get(loan.id);
      return {
        ...loan,
        withdrawalId: receipt?.withdrawalId ?? null,
        registryRecorded: Boolean(receipt?.registryTx),
      };
    });

    return NextResponse.json(
      // With no contract configured the client hides the whole feature rather than
      // offering an action that would answer 404.
      { loans: loansWithRegistry, debt, collateral, registryEnabled: registryEnabled() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to fetch loans") },
      { status: 502 },
    );
  }
}
