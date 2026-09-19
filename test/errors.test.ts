import { describe, expect, it } from "vitest";
import { getErrorMessage } from "@/lib/errors";

describe("getErrorMessage", () => {
  it("returns the message of a real Error instance", () => {
    expect(getErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("returns the message of a plain object with a string message (e.g. Supabase's PostgrestError)", () => {
    expect(getErrorMessage({ message: "duplicate key value" }, "fallback")).toBe("duplicate key value");
  });

  it("falls back when the value has no usable message", () => {
    expect(getErrorMessage("just a string", "fallback")).toBe("fallback");
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(getErrorMessage({ message: 42 }, "fallback")).toBe("fallback");
  });
});
