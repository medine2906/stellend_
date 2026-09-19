import { NextResponse } from "next/server";
import { Asset, Horizon } from "@stellar/stellar-sdk";
import { getSession } from "@/lib/session";
import { requireEnv } from "@/lib/env";
import { HORIZON_URL, STELLAR_NETWORK } from "@/lib/stellar";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const account = await new Horizon.Server(HORIZON_URL).loadAccount(session.publicKey);
    const id = requireEnv("NEXT_PUBLIC_USDC_CONTRACT_ID");
    const balance = account.balances.find(b => b.asset_type !== "native" && b.asset_type !== "liquidity_pool_shares" && new Asset(b.asset_code, b.asset_issuer).contractId(STELLAR_NETWORK) === id);
    const available = balance ? Math.max(0, Number(balance.balance) - Number("selling_liabilities" in balance ? balance.selling_liabilities : 0)) : 0;
    return NextResponse.json({ publicKey: session.publicKey, balance: balance ? Number(balance.balance) : 0, available }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Wallet balance is temporarily unavailable." }, { status: 503 });
  }
}
