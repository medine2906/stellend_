import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimits } from "@/lib/ratelimit";

describe("rateLimit", () => {
  beforeEach(resetRateLimits);

  it("allows up to the limit and refuses the request after it", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("a", 3, 60_000, now).allowed).toBe(true);
    }
    const blocked = rateLimit("a", 3, 60_000, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBe(60);
  });

  it("starts a fresh window once the old one has passed", () => {
    const now = 1_000_000;
    rateLimit("a", 1, 60_000, now);
    expect(rateLimit("a", 1, 60_000, now).allowed).toBe(false);
    expect(rateLimit("a", 1, 60_000, now + 60_001).allowed).toBe(true);
  });

  it("counts each bucket separately, so one caller cannot exhaust another's budget", () => {
    const now = 1_000_000;
    rateLimit("a", 1, 60_000, now);
    expect(rateLimit("a", 1, 60_000, now).allowed).toBe(false);
    expect(rateLimit("b", 1, 60_000, now).allowed).toBe(true);
  });

  it("reports a shrinking retry-after as the window drains", () => {
    const now = 1_000_000;
    rateLimit("a", 1, 60_000, now);
    expect(rateLimit("a", 1, 60_000, now + 30_000).retryAfter).toBe(30);
  });
});
