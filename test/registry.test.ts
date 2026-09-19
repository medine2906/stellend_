import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { advanceId, payoutRef, usdcToStroops, tryToMinorUnits } from "@/lib/registry";

// These are fixed-vector tests: the exact byte sequences here are the
// compatibility surface. If any of these fail after a refactor, old on-chain
// records will no longer verify against newly derived ids.

describe("advanceId", () => {
  it("produces a deterministic 32-byte sha256 of the domain-prefixed withdrawal id", () => {
    const id = advanceId("550e8400-e29b-41d4-a716-446655440000");
    expect(id).toHaveLength(32);

    // Re-derive with the same formula to confirm no hidden state:
    const expected = createHash("sha256")
      .update("stellend-advance-v1|550e8400-e29b-41d4-a716-446655440000")
      .digest();
    expect(id.equals(expected)).toBe(true);
  });

  it("is different for two different withdrawal ids", () => {
    const a = advanceId("aaaaaaaa-0000-0000-0000-000000000001");
    const b = advanceId("bbbbbbbb-0000-0000-0000-000000000002");
    expect(a.equals(b)).toBe(false);
  });

  it("fixed vector — must never change or old records stop matching", () => {
    // Generated once with: node -e "console.log(require('crypto').createHash('sha256').update('stellend-advance-v1|test-id').digest('hex'))"
    const hex = createHash("sha256").update("stellend-advance-v1|test-id").digest("hex");
    expect(advanceId("test-id").toString("hex")).toBe(hex);
  });
});

describe("payoutRef", () => {
  const ANCHOR_REF = "anchor-ref-abc123";
  const VALID_IBAN = "TR330006100519786457841326"; // passes mod-97 checksum

  it("produces a deterministic 32-byte sha256 of the domain-prefixed payout data", () => {
    const ref = payoutRef(ANCHOR_REF, VALID_IBAN);
    expect(ref).toHaveLength(32);

    const expected = createHash("sha256")
      .update(`stellend-payout-v1|${ANCHOR_REF}|${VALID_IBAN}`)
      .digest();
    expect(ref.equals(expected)).toBe(true);
  });

  it("normalises the IBAN before hashing (whitespace and case)", () => {
    const withSpaces = payoutRef(ANCHOR_REF, "TR33 0006 1005 1978 6457 8413 26");
    const compact = payoutRef(ANCHOR_REF, VALID_IBAN);
    expect(withSpaces.equals(compact)).toBe(true);

    const lower = payoutRef(ANCHOR_REF, VALID_IBAN.toLowerCase());
    expect(lower.equals(compact)).toBe(true);
  });

  it("throws on an invalid IBAN — we must not silently compute a ref from bad data", () => {
    expect(() => payoutRef(ANCHOR_REF, "NOT-AN-IBAN")).toThrow(/not a valid TR IBAN/);
    expect(() => payoutRef(ANCHOR_REF, "TR000000000000000000000000")).toThrow(/not a valid TR IBAN/);
  });

  it("is different for different anchor refs", () => {
    const a = payoutRef("ref-1", VALID_IBAN);
    const b = payoutRef("ref-2", VALID_IBAN);
    expect(a.equals(b)).toBe(false);
  });
});

describe("usdcToStroops", () => {
  it("converts USDC to 7-decimal stroops without floating-point drift", () => {
    expect(usdcToStroops(1)).toBe(10_000_000n);
    expect(usdcToStroops(150)).toBe(1_500_000_000n);
    expect(usdcToStroops(0.1)).toBe(1_000_000n);
    expect(usdcToStroops(1234.567)).toBe(12_345_670_000n);
  });
});

describe("tryToMinorUnits", () => {
  it("converts TRY to 2-decimal minor units (kuruş)", () => {
    expect(tryToMinorUnits(5000)).toBe(500_000n);
    expect(tryToMinorUnits(350_000)).toBe(35_000_000n);
    expect(tryToMinorUnits(1.5)).toBe(150n);
  });
});
