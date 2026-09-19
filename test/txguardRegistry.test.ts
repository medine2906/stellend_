import { describe, expect, it } from "vitest";
import { Account, Address, Asset, Contract, Keypair, Networks, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import {
  assertRegistryMarkRepaid,
  assertRegistryOpen,
  TransactionMismatchError,
  type RegistryMarkRepaidExpected,
  type RegistryOpenExpected,
} from "@/lib/txguard";
import { advanceId, payoutRef } from "@/lib/registry";

// Kept in its own file rather than appended to txguard.test.ts: that file already
// binds `USDC` to the pool's contract id, and the registry cases need it as a
// stroop amount. Two meanings for one name in one module scope is what broke the
// whole suite last time — including the pool guards, silently.

const USER = Keypair.random();
const ATTACKER = Keypair.random();

const REGISTRY_ID = "CC2F5JAI2REPM4CMKLSI3EMFBNHVMPOEVY7GARSCHTNHEOL536NOVWQF";
const OTHER_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const WITHDRAWAL_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_WITHDRAWAL_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const ANCHOR_REF = "anchor-ref-abc";
const IBAN = "TR330006100519786457841326";
const OTHER_IBAN = "TR120006100519786457841327";

const DUE_AT = 1_800_000_000n;
const USDC_STROOPS = 1_500_000_000n; // 150 USDC, 7 decimals
const TRY_MINOR = 500_000n; //           5000 TRY, 2 decimals

function build(source: string, operation: xdr.Operation): string {
  return new TransactionBuilder(new Account(source, "1"), {
    fee: "1000000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build()
    .toXDR();
}

function addr(a: string): xdr.ScVal {
  return xdr.ScVal.scvAddress(Address.fromString(a).toScAddress());
}

function bytes(b: Buffer): xdr.ScVal {
  return xdr.ScVal.scvBytes(b);
}

function i128(n: bigint): xdr.ScVal {
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString(String(n >> 64n)),
      lo: xdr.Uint64.fromString(String(n & 0xffff_ffff_ffff_ffffn)),
    }),
  );
}

function u64(n: bigint): xdr.ScVal {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n)));
}

/** The `open` call as `lib/registry.ts` builds it, with each argument overridable. */
function openXdr(
  opts: {
    source?: string;
    contract?: string;
    fn?: string;
    borrower?: string;
    id?: Buffer;
    usdc?: bigint;
    tryAmt?: bigint;
    ref?: Buffer;
    dueAt?: bigint;
  } = {},
): string {
  const op = new Contract(opts.contract ?? REGISTRY_ID).call(
    opts.fn ?? "open",
    addr(opts.borrower ?? USER.publicKey()),
    bytes(opts.id ?? advanceId(WITHDRAWAL_ID)),
    i128(opts.usdc ?? USDC_STROOPS),
    i128(opts.tryAmt ?? TRY_MINOR),
    bytes(opts.ref ?? payoutRef(ANCHOR_REF, IBAN)),
    u64(opts.dueAt ?? DUE_AT),
  );
  return build(opts.source ?? USER.publicKey(), op);
}

function markRepaidXdr(
  opts: { source?: string; contract?: string; fn?: string; borrower?: string; id?: Buffer } = {},
): string {
  const op = new Contract(opts.contract ?? REGISTRY_ID).call(
    opts.fn ?? "mark_repaid",
    addr(opts.borrower ?? USER.publicKey()),
    bytes(opts.id ?? advanceId(WITHDRAWAL_ID)),
  );
  return build(opts.source ?? USER.publicKey(), op);
}

const openExpected: RegistryOpenExpected = {
  registryId: REGISTRY_ID,
  borrower: USER.publicKey(),
  id: advanceId(WITHDRAWAL_ID).toString("hex"),
  payoutRef: payoutRef(ANCHOR_REF, IBAN).toString("hex"),
  usdcStroops: USDC_STROOPS,
  tryMinorUnits: TRY_MINOR,
  dueAtSec: DUE_AT,
};

const closeExpected: RegistryMarkRepaidExpected = {
  registryId: REGISTRY_ID,
  borrower: USER.publicKey(),
  id: advanceId(WITHDRAWAL_ID).toString("hex"),
};

describe("assertRegistryOpen", () => {
  it("accepts the call the server asked for", () => {
    expect(() => assertRegistryOpen(openXdr(), USER.publicKey(), openExpected)).not.toThrow();
  });

  // Every argument is server-derived, so each of these is a client trying to record
  // something other than the advance it was quoted.

  it("refuses a call to another contract", () => {
    expect(() => assertRegistryOpen(openXdr({ contract: OTHER_CONTRACT }), USER.publicKey(), openExpected)).toThrow(
      TransactionMismatchError,
    );
  });

  it("refuses a different function on the registry", () => {
    expect(() => assertRegistryOpen(openXdr({ fn: "mark_repaid" }), USER.publicKey(), openExpected)).toThrow(
      /not 'open'/,
    );
  });

  it("refuses a record opened for someone else", () => {
    expect(() =>
      assertRegistryOpen(openXdr({ borrower: ATTACKER.publicKey() }), USER.publicKey(), openExpected),
    ).toThrow(/different borrower/);
  });

  it("refuses an id belonging to a different withdrawal", () => {
    expect(() =>
      assertRegistryOpen(openXdr({ id: advanceId(OTHER_WITHDRAWAL_ID) }), USER.publicKey(), openExpected),
    ).toThrow(/advance id/);
  });

  it("refuses a payout_ref for a different IBAN", () => {
    expect(() =>
      assertRegistryOpen(openXdr({ ref: payoutRef(ANCHOR_REF, OTHER_IBAN) }), USER.publicKey(), openExpected),
    ).toThrow(/payout_ref/);
  });

  // Understating the debt or overstating the fiat would both leave a signed record
  // that flatters the borrower against what the pool and the anchor actually did.
  it("refuses a USDC amount that is not the quoted one", () => {
    expect(() => assertRegistryOpen(openXdr({ usdc: USDC_STROOPS - 1n }), USER.publicKey(), openExpected)).toThrow(
      /USDC amount/,
    );
    expect(() => assertRegistryOpen(openXdr({ usdc: USDC_STROOPS + 1n }), USER.publicKey(), openExpected)).toThrow(
      /USDC amount/,
    );
  });

  it("refuses a TRY amount that is not the quoted one", () => {
    expect(() => assertRegistryOpen(openXdr({ tryAmt: TRY_MINOR + 1n }), USER.publicKey(), openExpected)).toThrow(
      /TRY amount/,
    );
  });

  // The invariant from the design: what is signed on-chain and what the UI shows
  // must be the same instant, or the borrower agreed to something they never saw.
  it("refuses a due date other than the one on the loan row", () => {
    expect(() => assertRegistryOpen(openXdr({ dueAt: DUE_AT + 86_400n }), USER.publicKey(), openExpected)).toThrow(
      /due date/,
    );
  });

  it("refuses a transaction sent from another account", () => {
    expect(() => assertRegistryOpen(openXdr({ source: ATTACKER.publicKey() }), USER.publicKey(), openExpected)).toThrow(
      /different account/,
    );
  });

  it("refuses a transaction that is not a contract call", () => {
    const payment = build(
      USER.publicKey(),
      Operation.payment({
        destination: ATTACKER.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }) as unknown as xdr.Operation,
    );
    expect(() => assertRegistryOpen(payment, USER.publicKey(), openExpected)).toThrow(/expected a contract call/);
  });

  it("refuses a bundle of operations", () => {
    const op = new Contract(REGISTRY_ID).call("open", addr(USER.publicKey()), bytes(advanceId(WITHDRAWAL_ID)));
    const tx = new TransactionBuilder(new Account(USER.publicKey(), "1"), {
      fee: "1000000",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(op)
      .addOperation(op)
      .setTimeout(60)
      .build()
      .toXDR();
    expect(() => assertRegistryOpen(tx, USER.publicKey(), openExpected)).toThrow(/expected exactly 1/);
  });
});

describe("assertRegistryMarkRepaid", () => {
  it("accepts the close the server asked for", () => {
    expect(() => assertRegistryMarkRepaid(markRepaidXdr(), USER.publicKey(), closeExpected)).not.toThrow();
  });

  it("refuses a call to another contract", () => {
    expect(() =>
      assertRegistryMarkRepaid(markRepaidXdr({ contract: OTHER_CONTRACT }), USER.publicKey(), closeExpected),
    ).toThrow(TransactionMismatchError);
  });

  it("refuses a different function on the registry", () => {
    expect(() => assertRegistryMarkRepaid(markRepaidXdr({ fn: "open" }), USER.publicKey(), closeExpected)).toThrow(
      /not 'mark_repaid'/,
    );
  });

  it("refuses closing someone else's record", () => {
    expect(() =>
      assertRegistryMarkRepaid(markRepaidXdr({ borrower: ATTACKER.publicKey() }), USER.publicKey(), closeExpected),
    ).toThrow(/different borrower/);
  });

  it("refuses closing a different advance", () => {
    expect(() =>
      assertRegistryMarkRepaid(markRepaidXdr({ id: advanceId(OTHER_WITHDRAWAL_ID) }), USER.publicKey(), closeExpected),
    ).toThrow(/advance id/);
  });

  it("refuses a transaction sent from another account", () => {
    expect(() =>
      assertRegistryMarkRepaid(markRepaidXdr({ source: ATTACKER.publicKey() }), USER.publicKey(), closeExpected),
    ).toThrow(/different account/);
  });
});
