import { describe, expect, it } from "vitest";
import {
  MAX_UTILIZATION,
  dailyInterest,
  dropUntilLiquidation,
  dueDateFrom,
  exceedsUtilizationCap,
  idleLiquidity,
  loanTiming,
  maxBorrowable,
  nextLoanStatus,
  positionRisk,
} from "@/lib/liquidity";

describe("idleLiquidity", () => {
  it("is supplied minus borrowed", () => {
    expect(idleLiquidity(1000, 400)).toBe(600);
  });

  it("never goes negative", () => {
    expect(idleLiquidity(100, 150)).toBe(0);
  });
});

describe("exceedsUtilizationCap", () => {
  it("allows a borrow that stays at or under the cap", () => {
    expect(exceedsUtilizationCap(1000, 0, 1000 * MAX_UTILIZATION)).toBe(false);
  });

  it("rejects a borrow that crosses the cap", () => {
    expect(exceedsUtilizationCap(1000, 800, 100)).toBe(true);
  });

  it("rejects any borrow from an empty pool", () => {
    expect(exceedsUtilizationCap(0, 0, 1)).toBe(true);
  });
});

describe("maxBorrowable", () => {
  it("is the headroom below the cap", () => {
    expect(maxBorrowable(1000, 500)).toBeCloseTo(1000 * MAX_UTILIZATION - 500);
  });

  it("is 0 once the pool is at or over the cap", () => {
    expect(maxBorrowable(1000, 900)).toBe(0);
  });
});

describe("loanTiming", () => {
  const due = "2026-01-10T00:00:00Z";

  it("is current before the due date, and when there is no due date", () => {
    expect(loanTiming(due, new Date("2026-01-09T00:00:00Z"))).toBe("current");
    expect(loanTiming(null, new Date("2030-01-01T00:00:00Z"))).toBe("current");
  });

  it("is overdue inside the grace period", () => {
    expect(loanTiming(due, new Date("2026-01-12T00:00:00Z"))).toBe("overdue");
  });

  it("is defaulted after the grace period", () => {
    expect(loanTiming(due, new Date("2026-01-14T00:00:00Z"))).toBe("defaulted");
  });
});

describe("dueDateFrom", () => {
  it("adds the loan term", () => {
    const due = dueDateFrom(new Date("2026-01-01T00:00:00Z"));
    expect(due.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});

describe("positionRisk", () => {
  it("is liquidated when both debt and collateral are gone", () => {
    expect(positionRisk(0, 0)).toBe("liquidated");
  });

  it("is no-debt when collateral remains without debt", () => {
    expect(positionRisk(50, 0)).toBe("no-debt");
  });

  it("is at-risk near the liquidation threshold and safe well above it", () => {
    expect(positionRisk(110, 100)).toBe("at-risk");
    expect(positionRisk(200, 100)).toBe("safe");
  });
});

describe("nextLoanStatus", () => {
  const now = new Date("2026-02-01T00:00:00Z");
  const pastDue = "2026-01-01T00:00:00Z";

  it("marks liquidated when the position is gone", () => {
    expect(nextLoanStatus(null, now, "liquidated")).toBe("liquidated");
  });

  it("marks defaulted when past due + grace with debt outstanding", () => {
    expect(nextLoanStatus(pastDue, now, "safe")).toBe("defaulted");
  });

  it("leaves repaid-looking positions and current loans alone", () => {
    expect(nextLoanStatus(pastDue, now, "no-debt")).toBeNull();
    expect(nextLoanStatus("2026-03-01T00:00:00Z", now, "safe")).toBeNull();
  });
});

describe("dailyInterest", () => {
  it("is what one more day at today's rate costs", () => {
    // 1000 USDC at 7.3% APR: 1000 * 0.073 / 365 = 0.20 a day.
    expect(dailyInterest(1000, 0.073)).toBeCloseTo(0.2, 6);
  });

  it("is zero with no debt, and with a zero or negative rate", () => {
    expect(dailyInterest(0, 0.1)).toBe(0);
    expect(dailyInterest(1000, 0)).toBe(0);
    expect(dailyInterest(1000, -0.1)).toBe(0);
  });
});

describe("dropUntilLiquidation", () => {
  it("is how far collateral can fall before it no longer covers the debt", () => {
    // 200 of collateral against 100 of debt survives a 50% fall.
    expect(dropUntilLiquidation(200, 100)).toBeCloseTo(0.5, 6);
    expect(dropUntilLiquidation(125, 100)).toBeCloseTo(0.2, 6);
  });

  it("is zero, not negative, for a position already underwater", () => {
    expect(dropUntilLiquidation(90, 100)).toBe(0);
  });

  it("is null when there is no debt or no collateral to measure", () => {
    expect(dropUntilLiquidation(200, 0)).toBeNull();
    expect(dropUntilLiquidation(0, 100)).toBeNull();
  });
});
