import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { createSupabaseMock } from "./helpers/supabaseMock";

const VICTIM = Keypair.random().publicKey();
const ATTACKER = Keypair.random().publicKey();
const ANCHOR_SERVER = Keypair.random().publicKey();

let supabase = createSupabaseMock();
let tokenSubject = VICTIM;
const setSessionCookie = vi.fn();

vi.mock("@/lib/anchor", () => ({
  // The anchor only ever issues a token for the account that signed the challenge.
  submitSep10Challenge: async () => ({ token: jwtFor(tokenSubject) }),
}));
vi.mock("@/lib/session", () => ({ setSessionCookie: (...args: unknown[]) => setSessionCookie(...args) }));
vi.mock("@/lib/supabase", () => ({ getSupabaseServiceClient: () => supabase.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

function jwtFor(sub: string): string {
  const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

function challengeFor(clientAccount: string): string {
  return new TransactionBuilder(new Account(ANCHOR_SERVER, "-1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: "stellend auth", value: "abcd", source: clientAccount }))
    .setTimeout(300)
    .build()
    .toXDR();
}

function request(body: unknown) {
  return new Request("http://localhost/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  tokenSubject = VICTIM;
  supabase = createSupabaseMock({ profiles: [] });
  setSessionCookie.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/auth/token", () => {
  it("opens a session for the account the anchor authenticated", async () => {
    const { POST } = await import("@/app/api/auth/token/route");

    const res = await POST(request({ transaction: challengeFor(VICTIM), publicKey: VICTIM }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, publicKey: VICTIM });
    expect(setSessionCookie).toHaveBeenCalledWith({ jwt: expect.any(String), publicKey: VICTIM });
  });

  it("refuses to open a session for an account the token does not belong to", async () => {
    // The attacker completes SEP-10 with their own key, then claims to be the victim.
    tokenSubject = ATTACKER;
    const { POST } = await import("@/app/api/auth/token/route");

    const res = await POST(request({ transaction: challengeFor(ATTACKER), publicKey: VICTIM }));

    expect(res.status).toBe(401);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("refuses a challenge that was issued for a different account than the token", async () => {
    const { POST } = await import("@/app/api/auth/token/route");

    const res = await POST(request({ transaction: challengeFor(ATTACKER), publicKey: VICTIM }));

    expect(res.status).toBe(401);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("requires both the challenge and the claimed account", async () => {
    const { POST } = await import("@/app/api/auth/token/route");

    expect((await POST(request({ publicKey: VICTIM }))).status).toBe(400);
    expect((await POST(request({ transaction: challengeFor(VICTIM) }))).status).toBe(400);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });
});
