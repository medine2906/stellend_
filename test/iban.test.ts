import { describe, expect, it } from "vitest";
import { buildTrIban, formatIban, normalizeIban } from "@/lib/iban";

// A real-format Turkish IBAN with valid check digits, built the same way the sandbox does.
const VALID = buildTrIban("0006100519786457841326");

describe("normalizeIban", () => {
  it("strips spacing and accepts a well-formed Turkish IBAN", () => {
    expect(normalizeIban(formatIban(VALID))).toBe(VALID);
    expect(normalizeIban(VALID.toLowerCase())).toBe(VALID);
  });

  it("rejects a mistyped digit, which the checksum is there to catch", () => {
    const lastDigit = Number(VALID.slice(-1));
    const typo = `${VALID.slice(0, -1)}${(lastDigit + 1) % 10}`;
    expect(normalizeIban(typo)).toBeNull();
  });

  it("rejects anything that is not a 26-character TR IBAN", () => {
    expect(normalizeIban("")).toBeNull();
    expect(normalizeIban("TR12")).toBeNull();
    expect(normalizeIban("DE89370400440532013000")).toBeNull();
    expect(normalizeIban(`${VALID}0`)).toBeNull();
  });
});

describe("buildTrIban", () => {
  it("produces IBANs that pass the same validation real ones do", () => {
    for (let i = 0; i < 200; i++) {
      const bban = Array.from({ length: 22 }, () => Math.floor(Math.random() * 10)).join("");
      expect(normalizeIban(buildTrIban(bban))).toBe(buildTrIban(bban));
    }
  });

  it("refuses an account part that is not 22 digits", () => {
    expect(() => buildTrIban("123")).toThrow();
  });
});

describe("formatIban", () => {
  it("groups in fours for display", () => {
    expect(formatIban(VALID)).toMatch(/^TR\d{2}( \d{4}){5} \d{2}$/);
  });
});
