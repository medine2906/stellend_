import { describe, expect, it } from "vitest";
import { borrowStage } from "@/lib/borrowIntent";

const intent = (over: Partial<Parameters<typeof borrowStage>[0]> = {}) => ({
  collateral_tx: null,
  borrow_tx: null,
  payout_tx: null,
  status: "pending" as const,
  ...over,
});

describe("borrowStage", () => {
  it("starts at the collateral step when nothing has landed", () => {
    expect(borrowStage(intent())).toBe("collateral");
  });

  it("moves to borrowing once collateral is locked", () => {
    expect(borrowStage(intent({ collateral_tx: "a" }))).toBe("borrow");
  });

  it("reports the payout step while the borrower holds debt but no cash", () => {
    expect(borrowStage(intent({ collateral_tx: "a", borrow_tx: "b" }))).toBe("payout");
  });

  it("waits on the anchor once the USDC has been sent", () => {
    expect(borrowStage(intent({ collateral_tx: "a", borrow_tx: "b", payout_tx: "c" }))).toBe("settling");
  });

  it("is done when the anchor has paid the cash out", () => {
    expect(borrowStage(intent({ collateral_tx: "a", borrow_tx: "b", payout_tx: "c", status: "completed" }))).toBe("done");
  });
});
