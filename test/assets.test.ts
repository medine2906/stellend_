import { describe, expect, it } from "vitest";
import { TRY_SEP38_ASSET, USDC_ASSET_CODE, USDC_ISSUER, usdcSep38Asset } from "@/lib/assets";

describe("usdcSep38Asset", () => {
  it("defaults to the TR Mock Anchor's USDC issuer", () => {
    expect(usdcSep38Asset()).toBe(`stellar:${USDC_ASSET_CODE}:${USDC_ISSUER}`);
  });

  it("uses a caller-supplied issuer when given one", () => {
    expect(usdcSep38Asset("GABCDEF")).toBe(`stellar:${USDC_ASSET_CODE}:GABCDEF`);
  });
});

describe("TRY_SEP38_ASSET", () => {
  it("is the ISO-4217 SEP-38 asset identifier for Turkish lira", () => {
    expect(TRY_SEP38_ASSET).toBe("iso4217:TRY");
  });
});
