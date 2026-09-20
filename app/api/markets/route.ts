import { NextResponse } from "next/server";
import { PoolV2, ReserveConfigV2 } from "@blend-capital/blend-sdk";
import { requireEnv } from "@/lib/env";
import { STELLAR_NETWORK } from "@/lib/stellar";
import { getUsdTryRate } from "@/lib/fx";
export async function GET() {
  try {
    const pool = await PoolV2.load({ rpc: requireEnv("NEXT_PUBLIC_SOROBAN_RPC_URL"), passphrase: STELLAR_NETWORK }, requireEnv("NEXT_PUBLIC_BLEND_POOL_ID"));
    const id = requireEnv("NEXT_PUBLIC_USDC_CONTRACT_ID");
    const reserve = pool.reserves.get(id);
    if (!reserve) throw new Error("USDC reserve unavailable");
    const oracle = await pool.loadOracle().catch(() => null);
    if (!(reserve.config instanceof ReserveConfigV2)) throw new Error("Unsupported reserve configuration");
    // Evaluate the SDK's own rate model at each utilization, without changing the live reserve.
    const model = Object.assign(Object.create(Object.getPrototypeOf(reserve)), reserve) as typeof reserve;
    const utilizations = [...new Set([...Array.from({ length: 101 }, (_, i) => i / 100), reserve.config.util / 1e7])].sort((a, b) => a - b);
    const rateCurve = utilizations.map(utilization => {
      model.getUtilization = () => BigInt(Math.round(utilization * 1e7));
      model.setRates(BigInt(pool.metadata.backstopRate));
      return { utilization, apr: model.borrowApr };
    });
    const tryRate = await getUsdTryRate();
    return NextResponse.json({ tryRate, assets: [{ id, symbol: "USDC", name: "USD Coin", supplied: reserve.totalSupplyFloat(), borrowed: reserve.totalLiabilitiesFloat(), supplyApr: reserve.supplyApr, borrowApr: reserve.borrowApr,
      supplyApy: reserve.estSupplyApy, borrowApy: reserve.estBorrowApy, utilization: reserve.getUtilizationFloat(),
      supplyCap: Number(reserve.config.supply_cap) / 10 ** reserve.config.decimals,
      collateralFactor: reserve.getCollateralFactor(), liabilityFactor: reserve.getLiabilityFactor(),
      maxUtilization: reserve.config.max_util / 1e7, targetUtilization: reserve.config.util / 1e7,
      enabled: reserve.config.enabled, backstopRate: pool.metadata.backstopRate / 1e7,
      backstop: pool.metadata.backstop, poolId: pool.id, oracleId: pool.metadata.oracle,
      oraclePrice: oracle?.getPriceFloat(id) ?? null, ledger: reserve.latestLedger,
      fetchedAt: new Date().toISOString(), rateCurve,
    }] }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // The response is deliberately generic; the cause (RPC 429/502, missing env, SDK shape) goes to the server log.
    console.error("[markets] failed to load live market data", err);
    return NextResponse.json({ error: "Live market data is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
