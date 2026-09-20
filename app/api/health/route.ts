import { NextResponse } from "next/server";
import { env } from "@/lib/env";

// Live, so a checked-out agent (or a person) can tell what is deployed and whether the
// testnet dependencies are answering before trusting anything else. Public and read-only:
// it reports config that is already in NEXT_PUBLIC_* and never touches a session or a key.
export const dynamic = "force-dynamic";

const REPO = "https://github.com/medine2906/stellend_";
const PROBE_TIMEOUT_MS = 4_000;

/** A dependency being down is a result to report, not an error to throw. */
async function probe(run: () => Promise<boolean>): Promise<boolean> {
  try {
    return await run();
  } catch {
    return false;
  }
}

async function sorobanRpcReachable(): Promise<boolean> {
  const res = await fetch(env.NEXT_PUBLIC_SOROBAN_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { result?: { status?: string } };
  return body.result?.status === "healthy";
}

async function anchorTomlReachable(): Promise<boolean> {
  const res = await fetch(`${env.NEXT_PUBLIC_ANCHOR_URL}/.well-known/stellar.toml`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return res.ok;
}

export async function GET() {
  const [sorobanRpc, anchorToml] = await Promise.all([
    probe(sorobanRpcReachable),
    probe(anchorTomlReachable),
  ]);

  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  const contractsConfigured = Boolean(env.NEXT_PUBLIC_BLEND_POOL_ID && env.NEXT_PUBLIC_USDC_CONTRACT_ID);

  return NextResponse.json({
    ok: sorobanRpc && anchorToml && contractsConfigured,
    // The framing the README insists on: this is never a production deployment.
    network: { name: "Stellar testnet", configured: env.NEXT_PUBLIC_STELLAR_NETWORK, proofOfConcept: true },
    build: {
      commit,
      commitUrl: commit ? `${REPO}/commit/${commit}` : null,
      source: REPO,
      llms: "/llms.txt",
      agentRules: `${REPO}/blob/main/AGENTS.md`,
      readme: `${REPO}/blob/main/README.md`,
      docs: `${REPO}/blob/main/docs/README.md`,
    },
    checks: {
      sorobanRpcReachable: sorobanRpc,
      anchorStellarTomlReachable: anchorToml,
      contractsConfigured,
      // Absent id means the registry routes answer 404 by design, not that something broke.
      advanceRegistryEnabled: Boolean(env.NEXT_PUBLIC_ADVANCE_REGISTRY_ID),
      // Config presence only; never the values, and no database round trip.
      supabaseConfigured: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    },
    contracts: {
      blendPool: env.NEXT_PUBLIC_BLEND_POOL_ID ?? null,
      usdc: env.NEXT_PUBLIC_USDC_CONTRACT_ID ?? null,
      advanceRegistry: env.NEXT_PUBLIC_ADVANCE_REGISTRY_ID ?? null,
    },
    anchor: { url: env.NEXT_PUBLIC_ANCHOR_URL, stellarToml: `${env.NEXT_PUBLIC_ANCHOR_URL}/.well-known/stellar.toml` },
  });
}
