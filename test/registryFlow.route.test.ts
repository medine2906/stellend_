import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createSupabaseMock } from "./helpers/supabaseMock";

// The two registry `prepare` routes decide *whether* a record may be signed at all. The
// guard in txguard.ts checks what the borrower signed; these checks are about whether we
// should be putting a signature request in front of them in the first place.

const BORROWER = Keypair.random().publicKey();
const session = { jwt: "anchor.jwt.token", publicKey: BORROWER };

let supabase = createSupabaseMock();

vi.mock("@/lib/session", () => ({ getSession: async () => session }));
vi.mock("@/lib/supabase", () => ({ getSupabaseServiceClient: () => supabase.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/txlog", () => ({ recordTransaction: vi.fn() }));
// Building the real transaction would need an RPC to simulate against; the argument
// derivation under test happens before that, in lib/registry.
const submitSignedTransaction = vi.fn(async () => ({ hash: "tx-hash-1" }));
const advanceRecordExists = vi.fn(async () => false);

vi.mock("@/lib/blend", () => ({
  prepareSorobanTransaction: async () => "unsigned-xdr",
  submitSignedTransaction: () => submitSignedTransaction(),
}));
// Everything else in lib/registry is pure and worth exercising for real; only the call
// that reaches an RPC is stubbed.
vi.mock("@/lib/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/registry")>()),
  advanceRecordExists: () => advanceRecordExists(),
}));
// What the borrower signed is checked by txguardRegistry.test.ts; these tests are about
// what the route does with the submission afterwards.
vi.mock("@/lib/txguard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/txguard")>()),
  assertRegistryOpen: vi.fn(),
}));

const DAY_MS = 86_400_000;

function request(body: unknown = {}) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

/** An advance that has been paid out, with its loan row, as the borrow flow leaves it. */
function seed(overrides: { loan?: Record<string, unknown>; withdrawal?: Record<string, unknown> } = {}) {
  supabase = createSupabaseMock({
    profiles: [{ id: "profile-1", stellar_public_key: BORROWER }],
    loans: [
      {
        id: "loan-1",
        borrower_id: "profile-1",
        collateral_asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        collateral_amount: 100,
        borrowed_usdc_amount: 150,
        try_amount: 5000,
        status: "active",
        created_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
        registry_closed_tx: null,
        ...overrides.loan,
      },
    ],
    withdrawals: [
      {
        id: "withdrawal-1",
        borrower_id: "profile-1",
        loan_id: "loan-1",
        try_amount: 5000,
        usdc_amount: 150,
        iban: "TR330006100519786457841326",
        anchor_ref: "anchor-tx-1",
        status: "processing",
        anchor_account: Keypair.random().publicKey(),
        anchor_memo: null,
        anchor_memo_type: null,
        collateral_asset: null,
        collateral_amount: null,
        collateral_tx: "collateral-hash",
        borrow_tx: "borrow-hash",
        payout_tx: "payout-hash",
        advance_id: null,
        registry_tx: null,
        registry_recorded_at: null,
        created_at: new Date().toISOString(),
        ...overrides.withdrawal,
      },
    ],
  });
}

beforeEach(() => {
  vi.resetModules();
  submitSignedTransaction.mockReset();
  submitSignedTransaction.mockResolvedValue({ hash: "tx-hash-1" });
  advanceRecordExists.mockReset();
  advanceRecordExists.mockResolvedValue(false);
  seed();
});

async function postRecordPrepare(body: unknown) {
  const { POST } = await import("@/app/api/loans/borrow/record/prepare/route");
  return POST(request(body));
}

async function postRecordSubmit(body: unknown) {
  const { POST } = await import("@/app/api/loans/borrow/record/submit/route");
  return POST(request(body));
}

async function postClosePrepare(loanId: string) {
  const { POST } = await import("@/app/api/loans/[id]/registry/close/prepare/route");
  return POST(request({}), { params: Promise.resolve({ id: loanId }) });
}

describe("POST /api/loans/borrow/record/prepare", () => {
  it("prepares the record once the payout has landed", async () => {
    const res = await postRecordPrepare({ withdrawalId: "withdrawal-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unsignedXdr: "unsigned-xdr" });
  });

  it("refuses before the payout has landed, when there is nothing settled to record", async () => {
    seed({ withdrawal: { payout_tx: null } });
    const res = await postRecordPrepare({ withdrawalId: "withdrawal-1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/payout has not landed/);
  });

  // The contract rejects a due date that is not ahead of the ledger, so an advance whose
  // target has gone by can never be recorded. Saying so beats an opaque contract error
  // after the borrower has already signed.
  it("refuses once the target close date has passed", async () => {
    seed({ loan: { due_at: new Date(Date.now() - DAY_MS).toISOString() } });
    const res = await postRecordPrepare({ withdrawalId: "withdrawal-1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already passed/);
  });

  it("refuses an advance that is already recorded", async () => {
    seed({ withdrawal: { registry_tx: "registry-hash" } });
    const res = await postRecordPrepare({ withdrawalId: "withdrawal-1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already recorded/);
  });

  it("refuses one recorded without a hash, too", async () => {
    seed({ withdrawal: { registry_recorded_at: new Date().toISOString() } });
    const res = await postRecordPrepare({ withdrawalId: "withdrawal-1" });
    expect(res.status).toBe(409);
  });

  it("refuses an advance belonging to another wallet", async () => {
    seed({ withdrawal: { borrower_id: "profile-2" } });
    const res = await postRecordPrepare({ withdrawalId: "withdrawal-1" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/loans/[id]/registry/close/prepare", () => {
  it("prepares the closing record for a settled advance", async () => {
    seed({ loan: { status: "repaid" }, withdrawal: { registry_tx: "registry-hash" } });
    const res = await postClosePrepare("loan-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unsignedXdr: "unsigned-xdr" });
  });

  // The contract cannot see the pool, so it would store whatever the borrower signs. If we
  // offered this with debt outstanding we would be handing them a signed "settled" receipt
  // that the pool contradicts.
  it("refuses while the debt is still outstanding", async () => {
    seed({ loan: { status: "active" }, withdrawal: { registry_tx: "registry-hash" } });
    const res = await postClosePrepare("loan-1");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not settled yet/);
  });

  it("refuses a loan belonging to another wallet", async () => {
    seed({ loan: { status: "repaid", borrower_id: "profile-2" } });
    const res = await postClosePrepare("loan-1");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/loans/borrow/record/submit", () => {
  it("caches the record once it lands", async () => {
    const res = await postRecordSubmit({ withdrawalId: "withdrawal-1", signedXdr: "signed" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash: "tx-hash-1" });
    expect(supabase.tables.withdrawals[0].registry_tx).toBe("tx-hash-1");
  });

  // The hole this closes: the record lands, the row update fails, the UI offers to sign
  // again, and the contract rejects the replay forever. The advance would never show as
  // recorded however many times the borrower tried.
  it("treats a replay of a record already on chain as success", async () => {
    submitSignedTransaction.mockRejectedValue(new Error("Transaction did not succeed: txFailed"));
    advanceRecordExists.mockResolvedValue(true);

    const res = await postRecordSubmit({ withdrawalId: "withdrawal-1", signedXdr: "signed" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alreadyRecorded: true });

    // No hash to link to — the first attempt was the one that landed — so the timestamp
    // is what stops the UI asking again.
    const row = supabase.tables.withdrawals[0];
    expect(row.registry_tx).toBeNull();
    expect(row.registry_recorded_at).toBeTruthy();
  });

  it("still reports a failure the chain does not confirm", async () => {
    submitSignedTransaction.mockRejectedValue(new Error("Transaction did not succeed: txFailed"));
    advanceRecordExists.mockResolvedValue(false);

    const res = await postRecordSubmit({ withdrawalId: "withdrawal-1", signedXdr: "signed" });
    expect(res.status).toBe(502);
    const row = supabase.tables.withdrawals[0];
    expect(row.registry_tx).toBeNull();
    expect(row.registry_recorded_at).toBeNull();
  });
});
