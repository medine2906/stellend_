import { describe, expect, it } from "vitest";
import { formatAnchorAmount, pickTomlValue } from "@/lib/anchor";

describe("formatAnchorAmount", () => {
  it("rounds to exactly 2 decimal places, as the anchor's SEP-6 endpoints require", () => {
    expect(formatAnchorAmount(12.3456789)).toBe("12.35");
    expect(formatAnchorAmount("500")).toBe("500.00");
    expect(formatAnchorAmount(0.001)).toBe("0.00");
  });

  it("accepts a numeric string as well as a number", () => {
    expect(formatAnchorAmount("99.999")).toBe("100.00");
  });
});

describe("pickTomlValue", () => {
  const toml = `
VERSION="2.1.0"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
WEB_AUTH_ENDPOINT="https://tr-mock-anchor.fly.dev/auth"
TRANSFER_SERVER="https://tr-mock-anchor.fly.dev/sep6"
ANCHOR_QUOTE_SERVER="https://tr-mock-anchor.fly.dev/sep38"
SIGNING_KEY="GABCDEFGH"
`;

  it("extracts a top-level key's quoted string value", () => {
    expect(pickTomlValue(toml, "WEB_AUTH_ENDPOINT")).toBe("https://tr-mock-anchor.fly.dev/auth");
    expect(pickTomlValue(toml, "TRANSFER_SERVER")).toBe("https://tr-mock-anchor.fly.dev/sep6");
    expect(pickTomlValue(toml, "ANCHOR_QUOTE_SERVER")).toBe("https://tr-mock-anchor.fly.dev/sep38");
    expect(pickTomlValue(toml, "SIGNING_KEY")).toBe("GABCDEFGH");
  });

  it("returns null for a key that isn't present", () => {
    expect(pickTomlValue(toml, "CURRENCIES")).toBeNull();
  });

  it("anchors the match to the start of a line, ignoring keys that only share a suffix", () => {
    const trickyToml = `NOT_WEB_AUTH_ENDPOINT="wrong"\nWEB_AUTH_ENDPOINT="right"`;
    expect(pickTomlValue(trickyToml, "WEB_AUTH_ENDPOINT")).toBe("right");
  });
});
