import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { PoolContractV2, RequestType } from "@blend-capital/blend-sdk";
import { toFixedAmount } from "@/lib/txguard";
import { createSupabaseMock } from "./helpers/supabaseMock";

// Set by vitest.config.ts, the same way the app reads them.
const POOL_ID = process.env.NEXT_PUBLIC_BLEND_POOL_ID!;
const USDC_CONTRACT = process.env.NEXT_PUBLIC_USDC_CONTRACT_ID!;
const XLM_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const BORROWER = Keypair.random().publicKey();
const ATTACKER = Keypair.random().publicKey();
const ANCHOR_ACCOUNT = Keypair.random().publicKey();

const session = { jwt: "anchor.jwt.token", publicKey: BORROWER };

let supabase = createSupabaseMock();
const submitSignedTransaction = vi.fn(async () => ({ hash: "tx-hash-1" }));

vi.mock("@/lib/session", () => ({ getSession: async () => session }));
vi.mock("@/lib/supabase", () => ({ getSupabaseServiceClient: () => supabase.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/txlog", () => ({ recordTransaction: vi.fn() }));
vi.mock("@/lib/blend", async () => ({
  submitSignedTransaction: (...args: unknown[]) => submitSignedTransaction(...(args as [])),
  getClassicAsset: async () => ({ code: "USDC", issuer: USDC_ISSUER }),
  getUserUsdcPosition: async () => ({ supplied: 0, borrowed: 0 }),
}));

function request(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function build(source: string, operation: xdr.Operation | ReturnType<typeof Operation.payment>): string {
  return new TransactionBuilder(new Account(source, "1"), { fee: "1000000", networkPassphrase: Networks.TESTNET })
    .addOperation(operation)
    .setTimeout(60)
    .build()
    .toXDR();
}

function poolSubmit(from: string, requestType: RequestType, asset: string, amount: bigint): string {
  const opXdr = new PoolContractV2(POOL_ID).submit({
    from,
    spender: from,
    to: from,
    requests: [{ request_type: requestType, address: asset, amount }],
  });
  return build(from, xdr.Operation.fromXDR(opXdr, "base64"));
}

/** A reserved cash advance, exactly as /borrow/start writes it. */
function seedIntent(overrides: Record<string, unknown> = {}) {
  supabase = createSupabaseMock({
    profiles: [{ id: "profile-1", stellar_public_key: BORROWER }],
    withdrawals: [
      {
        id: "withdrawal-1",
        borrower_id: "profile-1",
        loan_id: null,
        try_amount: 5000,
        usdc_amount: 150,
        iban: "TR330006100519786457841326",
        anchor_ref: "anchor-tx-1",
        status: "pending",
        anchor_account: ANCHOR_ACCOUNT,
        anchor_memo: "memo-1",
        anchor_memo_type: "text",
        collateral_asset: null,
        collateral_amount: null,
        collateral_tx: null,
        borrow_tx: null,
        payout_tx: null,
        created_at: new Date().toISOString(),
        ...overrides,
      },
    ],
    loans: [],
  });
}

const intent = () => supabase.tables.withdrawals[0];

beforeEach(() => {
  seedIntent();
  submitSignedTransaction.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/loans/collateral/submit", () => {
  it("records the collateral the signed transaction actually locks", async () => {
    const { POST } = await import("@/app/api/loans/collateral/submit/route");
    const signedXdr = poolSubmit(BORROWER, RequestType.SupplyCollateral, XLM_CONTRACT, toFixedAmount(1000));

    const res = await POST(
      request({ signedXdr, withdrawalId: "withdrawal-1", asset: XLM_CONTRACT, amount: 1000 }),
    );

    expect(await res.clone().json()).toEqual({ hash: "tx-hash-1" });
    expect(res.status).toBe(200);
    expect(intent().collateral_asset).toBe(XLM_CONTRACT);
    expect(intent().collateral_amount).toBe(1000);
    expect(intent().collateral_tx).toBe("tx-hash-1");
  });

  it("refuses to record more collateral than the transaction locks", async () => {
    const { POST } = await import("@/app/api/loans/collateral/submit/route");
    // Locks 1 XLM, claims 1000 — the loan would look over-collateralized.
    const signedXdr = poolSubmit(BORROWER, RequestType.SupplyCollateral, XLM_CONTRACT, toFixedAmount(1));

    const res = await POST(request({ signedXdr, withdrawalId: "withdrawal-1", asset: XLM_CONTRACT, amount: 1000 }));

    expect(res.status).toBe(400);
    expect(submitSignedTransaction).not.toHaveBeenCalled();
    expect(intent().collateral_tx).toBeNull();
  });

  it("refuses an advance that belongs to somebody else", async () => {
    const { POST } = await import("@/app/api/loans/collateral/submit/route");
    supabase.tables.withdrawals[0].borrower_id = "someone-else";
    const signedXdr = poolSubmit(BORROWER, RequestType.SupplyCollateral, XLM_CONTRACT, toFixedAmount(1000));

    const res = await POST(request({ signedXdr, withdrawalId: "withdrawal-1", asset: XLM_CONTRACT, amount: 1000 }));

    expect(res.status).toBe(404);
    expect(submitSignedTransaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/loans/borrow/submit", () => {
  const withCollateral = () =>
    seedIntent({ collateral_asset: XLM_CONTRACT, collateral_amount: 1000, collateral_tx: "collateral-hash" });

  it("writes the loan from the reserved intent, not from the request body", async () => {
    withCollateral();
    const { POST } = await import("@/app/api/loans/borrow/submit/route");
    const signedXdr = poolSubmit(BORROWER, RequestType.Borrow, USDC_CONTRACT, toFixedAmount(150));

    const res = await POST(
      // The body carries inflated figures; none of them may reach the loan row.
      request({ signedXdr, withdrawalId: "withdrawal-1", usdcAmount: 1, tryAmount: 1, collateralAmount: 999_999 }),
    );

    expect(res.status).toBe(200);
    const loan = supabase.tables.loans[0];
    expect(loan.borrowed_usdc_amount).toBe(150);
    expect(loan.try_amount).toBe(5000);
    expect(loan.collateral_amount).toBe(1000);
    expect(loan.status).toBe("pending");
    expect(intent().loan_id).toBe(loan.id);
  });

  it("rejects borrowing more than the advance was quoted for", async () => {
    withCollateral();
    const { POST } = await import("@/app/api/loans/borrow/submit/route");
    const signedXdr = poolSubmit(BORROWER, RequestType.Borrow, USDC_CONTRACT, toFixedAmount(10_000));

    const res = await POST(request({ signedXdr, withdrawalId: "withdrawal-1" }));

    expect(res.status).toBe(400);
    expect(submitSignedTransaction).not.toHaveBeenCalled();
    expect(supabase.tables.loans).toHaveLength(0);
  });

  it("refuses to borrow before collateral is locked", async () => {
    const { POST } = await import("@/app/api/loans/borrow/submit/route");
    const signedXdr = poolSubmit(BORROWER, RequestType.Borrow, USDC_CONTRACT, toFixedAmount(150));

    const res = await POST(request({ signedXdr, withdrawalId: "withdrawal-1" }));

    expect(res.status).toBe(409);
    expect(supabase.tables.loans).toHaveLength(0);
  });

  it("refuses to borrow the same advance twice", async () => {
    seedIntent({
      collateral_asset: XLM_CONTRACT,
      collateral_amount: 1000,
      collateral_tx: "collateral-hash",
      borrow_tx: "already-borrowed",
    });
    const { POST } = await import("@/app/api/loans/borrow/submit/route");
    const signedXdr = poolSubmit(BORROWER, RequestType.Borrow, USDC_CONTRACT, toFixedAmount(150));

    const res = await POST(request({ signedXdr, withdrawalId: "withdrawal-1" }));

    expect(res.status).toBe(409);
    expect(supabase.tables.loans).toHaveLength(0);
  });
});

describe("POST /api/loans/borrow/payout/submit", () => {
  const borrowed = () =>
    seedIntent({
      collateral_asset: XLM_CONTRACT,
      collateral_amount: 1000,
      collateral_tx: "collateral-hash",
      borrow_tx: "borrow-hash",
      loan_id: "loan-1",
    });

  const payment = (to: string, amount: string) =>
    build(
      BORROWER,
      Operation.payment({ destination: to, asset: new Asset("USDC", USDC_ISSUER), amount }),
    );

  it("accepts the payment that funds the anchor's cash-out", async () => {
    borrowed();
    const { POST } = await import("@/app/api/loans/borrow/payout/submit/route");

    const res = await POST(request({ signedXdr: payment(ANCHOR_ACCOUNT, "150.0000000"), withdrawalId: "withdrawal-1" }));

    expect(res.status).toBe(200);
    expect(intent().payout_tx).toBe("tx-hash-1");
    expect(intent().status).toBe("processing");
  });

  it("rejects a payment routed away from the anchor", async () => {
    borrowed();
    const { POST } = await import("@/app/api/loans/borrow/payout/submit/route");

    const res = await POST(request({ signedXdr: payment(ATTACKER, "150.0000000"), withdrawalId: "withdrawal-1" }));

    expect(res.status).toBe(400);
    expect(submitSignedTransaction).not.toHaveBeenCalled();
    expect(intent().payout_tx).toBeNull();
  });

  it("rejects underpaying the anchor", async () => {
    borrowed();
    const { POST } = await import("@/app/api/loans/borrow/payout/submit/route");

    const res = await POST(request({ signedXdr: payment(ANCHOR_ACCOUNT, "1.0000000"), withdrawalId: "withdrawal-1" }));

    expect(res.status).toBe(400);
    expect(intent().payout_tx).toBeNull();
  });
});

describe("GET /api/loans/borrow/resume", () => {
  it("reports the step an interrupted advance stopped at", async () => {
    seedIntent({
      collateral_asset: XLM_CONTRACT,
      collateral_amount: 1000,
      collateral_tx: "collateral-hash",
      borrow_tx: "borrow-hash",
    });
    const { GET } = await import("@/app/api/loans/borrow/resume/route");

    const { pending } = await (await GET()).json();

    // Borrowed but not paid out: the state where the borrower holds debt and no cash.
    expect(pending.stage).toBe("payout");
    expect(pending.withdrawalId).toBe("withdrawal-1");
    expect(pending.txs).toHaveLength(2);
  });

  it("offers nothing once the advance has settled", async () => {
    seedIntent({
      collateral_tx: "a",
      borrow_tx: "b",
      payout_tx: "c",
      status: "completed",
    });
    const { GET } = await import("@/app/api/loans/borrow/resume/route");

    // A completed withdrawal is not in the resumable set at all.
    expect((await (await GET()).json()).pending).toBeNull();
  });
});
