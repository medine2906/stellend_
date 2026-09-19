import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, Networks, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { PoolContractV2, RequestType } from "@blend-capital/blend-sdk";
import { toFixedAmount } from "@/lib/txguard";
import { createSupabaseMock } from "./helpers/supabaseMock";

const POOL_ID = process.env.NEXT_PUBLIC_BLEND_POOL_ID!;
const USDC_CONTRACT = process.env.NEXT_PUBLIC_USDC_CONTRACT_ID!;
const LENDER = Keypair.random().publicKey();

const session = { jwt: "anchor.jwt.token", publicKey: LENDER };

let supabase = createSupabaseMock();
let outstandingDebt = 0;
const submitSignedTransaction = vi.fn(async () => ({ hash: "tx-hash-1" }));

vi.mock("@/lib/session", () => ({ getSession: async () => session }));
vi.mock("@/lib/supabase", () => ({ getSupabaseServiceClient: () => supabase.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/txlog", () => ({ recordTransaction: vi.fn() }));
vi.mock("@/lib/blend", () => ({
  submitSignedTransaction: (...args: unknown[]) => submitSignedTransaction(...(args as [])),
  getUserUsdcPosition: async () => ({ supplied: 0, borrowed: outstandingDebt }),
}));

function request(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function poolSubmit(requestType: RequestType, amount: bigint, asset = USDC_CONTRACT): string {
  const opXdr = new PoolContractV2(POOL_ID).submit({
    from: LENDER,
    spender: LENDER,
    to: LENDER,
    requests: [{ request_type: requestType, address: asset, amount }],
  });
  return new TransactionBuilder(new Account(LENDER, "1"), { fee: "1000000", networkPassphrase: Networks.TESTNET })
    .addOperation(xdr.Operation.fromXDR(opXdr, "base64"))
    .setTimeout(60)
    .build()
    .toXDR();
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  outstandingDebt = 0;
  submitSignedTransaction.mockClear();
  supabase = createSupabaseMock({
    profiles: [{ id: "profile-1", stellar_public_key: LENDER }],
    deposits: [
      {
        id: "deposit-1",
        lender_id: "profile-1",
        try_amount: 5000,
        usdc_amount: 150,
        anchor_ref: "anchor-dep-1",
        status: "completed",
        supplied: false,
        created_at: new Date().toISOString(),
      },
    ],
    loans: [
      {
        id: "loan-1",
        borrower_id: "profile-1",
        collateral_asset: "XLM",
        collateral_amount: 1000,
        borrowed_usdc_amount: 150,
        try_amount: 5000,
        status: "active",
        created_at: new Date().toISOString(),
        due_at: null,
      },
    ],
  });
});
afterEach(() => vi.clearAllMocks());

const deposit = () => supabase.tables.deposits[0];
const loan = () => supabase.tables.loans[0];

describe("POST /api/deposit/[id]/supply/submit", () => {
  it("marks the deposit supplied once its USDC really reaches the pool", async () => {
    const { POST } = await import("@/app/api/deposit/[id]/supply/submit/route");

    const res = await POST(
      request({ signedXdr: poolSubmit(RequestType.Supply, toFixedAmount(150)) }),
      params("deposit-1"),
    );

    expect(res.status).toBe(200);
    expect(deposit().supplied).toBe(true);
  });

  it("refuses to credit a deposit for a transaction that supplies less than it", async () => {
    const { POST } = await import("@/app/api/deposit/[id]/supply/submit/route");

    const res = await POST(
      request({ signedXdr: poolSubmit(RequestType.Supply, toFixedAmount(1)) }),
      params("deposit-1"),
    );

    expect(res.status).toBe(400);
    expect(submitSignedTransaction).not.toHaveBeenCalled();
    expect(deposit().supplied).toBe(false);
  });

  it("refuses a deposit that belongs to another lender", async () => {
    deposit().lender_id = "someone-else";
    const { POST } = await import("@/app/api/deposit/[id]/supply/submit/route");

    const res = await POST(
      request({ signedXdr: poolSubmit(RequestType.Supply, toFixedAmount(150)) }),
      params("deposit-1"),
    );

    expect(res.status).toBe(404);
    expect(deposit().supplied).toBe(false);
  });

  it("refuses to supply the same deposit twice", async () => {
    deposit().supplied = true;
    const { POST } = await import("@/app/api/deposit/[id]/supply/submit/route");

    const res = await POST(
      request({ signedXdr: poolSubmit(RequestType.Supply, toFixedAmount(150)) }),
      params("deposit-1"),
    );

    expect(res.status).toBe(409);
    expect(submitSignedTransaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/loans/[id]/repay/submit", () => {
  it("marks the loan repaid only after the chain says the debt is gone", async () => {
    outstandingDebt = 0;
    const { POST } = await import("@/app/api/loans/[id]/repay/submit/route");

    const res = await POST(request({ signedXdr: poolSubmit(RequestType.Repay, toFixedAmount(150)) }), params("loan-1"));

    expect((await res.json()).fullyRepaid).toBe(true);
    expect(loan().status).toBe("repaid");
  });

  it("leaves the loan active while debt remains, whatever the client claims", async () => {
    outstandingDebt = 80;
    const { POST } = await import("@/app/api/loans/[id]/repay/submit/route");

    const res = await POST(
      request({ signedXdr: poolSubmit(RequestType.Repay, toFixedAmount(70)), fullyRepaid: true }),
      params("loan-1"),
    );

    expect((await res.json()).fullyRepaid).toBe(false);
    expect(loan().status).toBe("active");
  });

  it("rejects a transaction that is not a repayment", async () => {
    const { POST } = await import("@/app/api/loans/[id]/repay/submit/route");

    const res = await POST(
      request({ signedXdr: poolSubmit(RequestType.Withdraw, toFixedAmount(150)) }),
      params("loan-1"),
    );

    expect(res.status).toBe(400);
    expect(submitSignedTransaction).not.toHaveBeenCalled();
    expect(loan().status).toBe("active");
  });
});

describe("POST /api/withdraw-liquidity/submit", () => {
  it("accepts a lender withdrawing their own USDC", async () => {
    const { POST } = await import("@/app/api/withdraw-liquidity/submit/route");

    const res = await POST(request({ signedXdr: poolSubmit(RequestType.Withdraw, toFixedAmount(50)) }));

    expect(res.status).toBe(200);
  });

  it("rejects a transaction dressed up as a withdrawal", async () => {
    const { POST } = await import("@/app/api/withdraw-liquidity/submit/route");

    const res = await POST(request({ signedXdr: poolSubmit(RequestType.Borrow, toFixedAmount(50)) }));

    expect(res.status).toBe(400);
    expect(submitSignedTransaction).not.toHaveBeenCalled();
  });
});
