import { NextRequest, NextResponse } from "next/server";
import { getUserPoolPosition } from "@/lib/blend";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/errors";
import { nextLoanStatus, positionRisk } from "@/lib/liquidity";
import { requireEnv } from "@/lib/env";

/**
 * Keeper, meant to be hit by a scheduler (cron): reconciles each active or defaulted
 * loan's off-chain status with the borrower's on-chain Blend position.
 *
 * - position wiped out (no debt, no collateral) -> the pool's liquidation
 *   auction consumed it -> `liquidated`
 * - debt still outstanding past due date + grace -> `defaulted`. The debt keeps
 *   accruing interest on-chain; once collateral no longer covers it, Blend's
 *   own liquidators auction the collateral. We don't run a liquidation bot.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("authorization") !== `Bearer ${requireEnv("CRON_SECRET")}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseServiceClient();
    const { data: loans, error } = await supabase
      .from("loans")
      .select("id, due_at, borrower_id, status")
      .in("status", ["active", "defaulted"]);
    if (error) throw error;
    if (!loans || loans.length === 0) return NextResponse.json({ checked: 0, updated: [] });

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, stellar_public_key")
      .in("id", [...new Set(loans.map((loan) => loan.borrower_id))]);
    if (profilesError) throw profilesError;
    const walletById = new Map((profiles ?? []).map((p) => [p.id, p.stellar_public_key]));

    const now = new Date();
    // One on-chain read per wallet, even if it has several active loans.
    const riskByWallet = new Map<string, ReturnType<typeof positionRisk>>();
    const updated: { id: string; status: string }[] = [];

    for (const loan of loans) {
      const wallet = walletById.get(loan.borrower_id);
      if (!wallet) continue;
      let risk = riskByWallet.get(wallet);
      if (!risk) {
        const position = await getUserPoolPosition(wallet);
        risk = positionRisk(position.totalEffectiveCollateral, position.totalEffectiveLiabilities);
        riskByWallet.set(wallet, risk);
      }

      const status = nextLoanStatus(loan.due_at, now, risk);
      if (!status || status === loan.status) continue;
      const { error: updateError } = await supabase.from("loans").update({ status }).eq("id", loan.id);
      if (updateError) throw updateError;
      updated.push({ id: loan.id, status });
    }

    return NextResponse.json({ checked: loans.length, updated });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err, "Failed to sync loans") }, { status: 502 });
  }
}
