import { NextResponse } from "next/server";
import { PoolV2, ReserveConfigV2 } from "@blend-capital/blend-sdk";
import { requireEnv } from "@/lib/env";
import { STELLAR_NETWORK } from "@/lib/stellar";
import { getTokenSymbol } from "@/lib/blend";
import { getErrorMessage } from "@/lib/errors";

/**
 * The assets this pool will actually accept as collateral, with the loan-to-value each
 * one carries. Typing a contract address by hand was the only way to pick collateral
 * before, which let a borrower lock an asset with a zero collateral factor — posting
 * real value and being able to borrow nothing against it.
 */
export async function GET() {
  try {
    const usdcId = requireEnv("NEXT_PUBLIC_USDC_CONTRACT_ID");
    const pool = await PoolV2.load(
      { rpc: requireEnv("NEXT_PUBLIC_SOROBAN_RPC_URL"), passphrase: STELLAR_NETWORK },
      requireEnv("NEXT_PUBLIC_BLEND_POOL_ID"),
    );
    const oracle = await pool.loadOracle().catch(() => null);

    const options = await Promise.all(
      [...pool.reserves.entries()]
        // A v1 reserve has no `enabled` flag; there, a non-zero collateral factor is the test.
        .filter(([, reserve]) => {
          const disabled = reserve.config instanceof ReserveConfigV2 && !reserve.config.enabled;
          return !disabled && reserve.getCollateralFactor() > 0;
        })
        .map(async ([id, reserve]) => {
          // The pool knows an asset only by its contract; the ticker lives on the token itself.
          const symbol = id === usdcId ? "USDC" : await getTokenSymbol(id).catch(() => null);
          return {
            id,
            symbol: symbol ?? `${id.slice(0, 4)}…${id.slice(-4)}`,
            decimals: reserve.config.decimals,
            collateralFactor: reserve.getCollateralFactor(),
            /** Price in USD, or null when the oracle is unreachable — the UI must show "—", never a guess. */
            oraclePrice: oracle?.getPriceFloat(id) ?? null,
          };
        }),
    );

    return NextResponse.json({ options }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Could not load the assets this pool accepts as collateral") },
      { status: 503 },
    );
  }
}
