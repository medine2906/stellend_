#!/usr/bin/env node
/**
 * One-off diagnostic: given a Blend pool contract id, lists every reserve
 * asset in the pool along with the classic Stellar asset (code + issuer) it
 * resolves to, so we can tell which reserve (if any) is backed by the same
 * USDC issuer the TR Mock Anchor uses.
 *
 * Usage: node scripts/inspect-pool.mjs <POOL_CONTRACT_ID>
 */
import { PoolV2 } from "@blend-capital/blend-sdk";
import { Contract, TransactionBuilder, rpc, scValToNative } from "@stellar/stellar-sdk";

const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
// Any funded testnet account works as the simulation source — no signing happens.
const SIM_SOURCE_ACCOUNT = process.argv[3] ?? "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

const poolId = process.argv[2];
if (!poolId) {
  console.error("Usage: node scripts/inspect-pool.mjs <POOL_CONTRACT_ID> [SIMULATION_SOURCE_ACCOUNT]");
  process.exit(1);
}

const server = new rpc.Server(SOROBAN_RPC_URL);

async function getClassicAsset(contractId) {
  const account = await server.getAccount(SIM_SOURCE_ACCOUNT);
  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call("name"))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    return { error: `simulation failed: ${JSON.stringify(sim, (_key, value) => (typeof value === "bigint" ? value.toString() : value))}` };
  }
  const name = scValToNative(sim.result.retval);
  if (typeof name !== "string" || name === "native") return { code: "XLM", issuer: null, raw: name };
  const [code, issuer] = name.split(":");
  return { code, issuer };
}

async function main() {
  console.log(`Loading pool ${poolId} ...`);
  const network = { rpc: SOROBAN_RPC_URL, passphrase: NETWORK_PASSPHRASE };
  const pool = await PoolV2.load(network, poolId);

  // pool.reserves is a Map<assetId, Reserve> (see @blend-capital/blend-sdk's Pool class).
  const reserves = [...pool.reserves.values()];
  if (reserves.length === 0) {
    console.log("No reserves found on this pool.");
    return;
  }

  console.log(`Found ${reserves.length} reserve(s):\n`);
  for (const reserve of reserves) {
    const assetId = reserve.assetId;
    process.stdout.write(`- ${assetId} ... `);
    try {
      const classic = await getClassicAsset(assetId);
      console.log(JSON.stringify(classic));
    } catch (err) {
      console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    `\nAnchor's USDC issuer for comparison: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`,
  );
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
