import { describe, expect, it } from "vitest";
import { summarizeProfile } from "@/lib/profile";

describe("summarizeProfile", () => {
  const deposits = [
    { status: "completed" as const, try_amount: 500, usdc_amount: 10, supplied: true },
    { status: "completed" as const, try_amount: 100, usdc_amount: 2, supplied: false },
    { status: "pending" as const, try_amount: 900, usdc_amount: null, supplied: false },
  ];
  const loans = [
    { status: "active" as const, borrowed_usdc_amount: 5 },
    { status: "repaid" as const, borrowed_usdc_amount: 3 },
  ];

  it("totals completed deposits and the supplied principal", () => {
    const s = summarizeProfile(deposits, loans, 10.5, 5.2);
    expect(s.depositedTry).toBe(600);
    expect(s.suppliedPrincipalUsdc).toBe(10);
  });

  it("derives interest earned and owed from live balances", () => {
    const s = summarizeProfile(deposits, loans, 10.5, 5.2);
    expect(s.earnedUsdc).toBeCloseTo(0.5);
    expect(s.interestOwedUsdc).toBeCloseTo(0.2);
    expect(s.openLoans).toBe(1);
  });

  it("never reports negative interest", () => {
    const s = summarizeProfile(deposits, loans, 9, 4);
    expect(s.earnedUsdc).toBe(0);
    expect(s.interestOwedUsdc).toBe(0);
  });
});
