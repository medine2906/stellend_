import { describe, expect, it, vi } from "vitest";

const store = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => store.get(name),
    set: (name: string, value: string) => store.set(name, { value }),
    delete: (name: string) => store.delete(name),
  }),
}));

const { clearSessionCookie, getSession, setSessionCookie } = await import("@/lib/session");

const SESSION = { jwt: "header.payload.signature", publicKey: "GABC" };
const cookieValue = () => store.get("stellend_session")!.value;

describe("session cookie", () => {
  it("round-trips the session", async () => {
    await setSessionCookie(SESSION);
    expect(await getSession()).toEqual(SESSION);
  });

  it("does not store the anchor token in readable form", async () => {
    await setSessionCookie(SESSION);
    // The cookie carries a bearer token for the anchor; it must not be recoverable by
    // anyone who merely reads the cookie.
    expect(cookieValue()).not.toContain(SESSION.jwt);
    expect(Buffer.from(cookieValue().split(".")[1], "base64url").toString("utf8")).not.toContain(SESSION.jwt);
  });

  it("uses a fresh nonce each time, so two sessions never look alike", async () => {
    await setSessionCookie(SESSION);
    const first = cookieValue();
    await setSessionCookie(SESSION);
    expect(cookieValue()).not.toBe(first);
  });

  it("rejects a tampered cookie instead of trusting it", async () => {
    await setSessionCookie(SESSION);
    const [iv, ciphertext, tag] = cookieValue().split(".");
    const flipped = Buffer.from(ciphertext, "base64url");
    flipped[0] ^= 0xff;
    store.set("stellend_session", { value: [iv, flipped.toString("base64url"), tag].join(".") });

    expect(await getSession()).toBeNull();
  });

  it("returns null when there is no cookie at all", async () => {
    await clearSessionCookie();
    expect(await getSession()).toBeNull();
  });
});
