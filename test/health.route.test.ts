import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

// The endpoint is public, so the property worth proving is that a dead dependency is
// reported rather than thrown, and that nothing secret leaks into the body.

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => handler(String(url))));
}

const healthyRpc = () => Response.json({ result: { status: "healthy" } });

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/health", () => {
  it("reports ok when the RPC and the anchor answer", async () => {
    stubFetch((url) => (url.endsWith("stellar.toml") ? new Response("") : healthyRpc()));
    const body = await (await GET()).json();
    expect(body.ok).toBe(true);
    expect(body.checks.sorobanRpcReachable).toBe(true);
    expect(body.checks.anchorStellarTomlReachable).toBe(true);
    expect(body.network.proofOfConcept).toBe(true);
  });

  it("reports a failing dependency instead of throwing", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.checks.sorobanRpcReachable).toBe(false);
    expect(body.checks.anchorStellarTomlReachable).toBe(false);
  });

  it("treats an unhealthy RPC status as down", async () => {
    stubFetch((url) => (url.endsWith("stellar.toml") ? new Response("") : Response.json({ result: { status: "behind" } })));
    expect((await (await GET()).json()).checks.sorobanRpcReachable).toBe(false);
  });

  it("never exposes secrets", async () => {
    stubFetch(() => healthyRpc());
    const text = await (await GET()).text();
    expect(text).not.toContain("test-secret-that-is-long-enough-to-pass");
    expect(text).not.toContain("test-cron-secret");
  });
});
