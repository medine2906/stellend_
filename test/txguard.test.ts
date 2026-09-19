import { describe, expect, it } from "vitest";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { PoolContractV2, RequestType } from "@blend-capital/blend-sdk";
import {
  assertChangeTrust,
  assertPayment,
  assertPoolRequest,
  assertRestoreFootprint,
  decodePoolSubmit,
  toFixedAmount,
  TransactionMismatchError,
} from "@/lib/txguard";

const USER = Keypair.random();
const ATTACKER = Keypair.random();
// Set by vitest.config.ts, the same way the app reads them.
const POOL_ID = process.env.NEXT_PUBLIC_BLEND_POOL_ID!;
const USDC = process.env.NEXT_PUBLIC_USDC_CONTRACT_ID!;
const OTHER_POOL = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const ANCHOR = Keypair.random().publicKey();
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function build(source: string, operation: xdr.Operation | ReturnType<typeof Operation.payment>): string {
  return new TransactionBuilder(new Account(source, "1"), {
    fee: "1000000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build()
    .toXDR();
}

/** The same call `lib/blend.ts` builds for a pool action, without needing an RPC to prepare it. */
function poolSubmit(opts: {
  source?: string;
  from?: string;
  to?: string;
  pool?: string;
  requestType?: RequestType;
  asset?: string;
  amount?: bigint;
}): string {
  const source = opts.source ?? USER.publicKey();
  const from = opts.from ?? source;
  const opXdr = new PoolContractV2(opts.pool ?? POOL_ID).submit({
    from,
    spender: from,
    to: opts.to ?? from,
    requests: [
      {
        request_type: opts.requestType ?? RequestType.Borrow,
        address: opts.asset ?? USDC,
        amount: opts.amount ?? toFixedAmount(100),
      },
    ],
  });
  return build(source, xdr.Operation.fromXDR(opXdr, "base64"));
}

describe("decodePoolSubmit", () => {
  it("decodes the action, asset and amount of a pool call", () => {
    const requests = decodePoolSubmit(poolSubmit({ amount: toFixedAmount(250) }), USER.publicKey(), POOL_ID);
    expect(requests).toEqual([
      { requestType: RequestType.Borrow, address: USDC, amount: toFixedAmount(250) },
    ]);
  });

  it("rejects a transaction sent from another wallet", () => {
    const signed = poolSubmit({ source: ATTACKER.publicKey() });
    expect(() => decodePoolSubmit(signed, USER.publicKey(), POOL_ID)).toThrow(TransactionMismatchError);
  });

  it("rejects a call to a contract that is not our pool", () => {
    expect(() => decodePoolSubmit(poolSubmit({ pool: OTHER_POOL }), USER.publicKey(), POOL_ID)).toThrow(
      /not the lending pool/,
    );
  });

  it("rejects a call that moves another account's position", () => {
    // `from` is the account whose collateral and debt the call touches.
    const signed = poolSubmit({ source: USER.publicKey(), from: ATTACKER.publicKey() });
    expect(() => decodePoolSubmit(signed, USER.publicKey(), POOL_ID)).toThrow(/other than the signed-in wallet/);
  });

  it("rejects a non-contract operation", () => {
    const signed = build(USER.publicKey(), Operation.bumpSequence({ bumpTo: "100" }));
    expect(() => decodePoolSubmit(signed, USER.publicKey(), POOL_ID)).toThrow(/expected a contract call/);
  });

  it("rejects a transaction bundling more than one operation", () => {
    const tx = new TransactionBuilder(new Account(USER.publicKey(), "1"), {
      fee: "1000000",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: "100" }))
      .addOperation(Operation.bumpSequence({ bumpTo: "101" }))
      .setTimeout(60)
      .build();
    expect(() => decodePoolSubmit(tx.toXDR(), USER.publicKey(), POOL_ID)).toThrow(/bundles 2 operations/);
  });

  it("rejects gibberish that is not a transaction", () => {
    expect(() => decodePoolSubmit("not-an-xdr", USER.publicKey(), POOL_ID)).toThrow(/not a valid transaction/);
  });
});

describe("assertPoolRequest", () => {
  const expectBorrow = (extra: Partial<Parameters<typeof assertPoolRequest>[3]> = {}) => ({
    requestType: RequestType.Borrow,
    asset: USDC,
    ...extra,
  });

  it("accepts a borrow within the quoted ceiling", () => {
    const signed = poolSubmit({ amount: toFixedAmount(100) });
    expect(() =>
      assertPoolRequest(signed, USER.publicKey(), POOL_ID, expectBorrow({ maxAmount: toFixedAmount(100.01) })),
    ).not.toThrow();
  });

  it("rejects borrowing more than was quoted — debt the loan record would not show", () => {
    const signed = poolSubmit({ amount: toFixedAmount(10_000) });
    expect(() =>
      assertPoolRequest(signed, USER.publicKey(), POOL_ID, expectBorrow({ maxAmount: toFixedAmount(100.01) })),
    ).toThrow(/larger than the amount/);
  });

  it("rejects supplying less collateral than the amount being recorded", () => {
    const signed = poolSubmit({ requestType: RequestType.SupplyCollateral, amount: toFixedAmount(1) });
    expect(() =>
      assertPoolRequest(signed, USER.publicKey(), POOL_ID, {
        requestType: RequestType.SupplyCollateral,
        asset: USDC,
        minAmount: toFixedAmount(1000),
      }),
    ).toThrow(/smaller than the amount/);
  });

  it("rejects a different pool action than the step performs", () => {
    const signed = poolSubmit({ requestType: RequestType.WithdrawCollateral });
    expect(() => assertPoolRequest(signed, USER.publicKey(), POOL_ID, expectBorrow())).toThrow(
      /different pool action/,
    );
  });

  it("rejects an action on a different asset", () => {
    const signed = poolSubmit({ asset: OTHER_POOL });
    expect(() => assertPoolRequest(signed, USER.publicKey(), POOL_ID, expectBorrow())).toThrow(/different asset/);
  });
});

describe("assertPayment", () => {
  const expected = { to: ANCHOR, assetCode: "USDC", assetIssuer: ISSUER, minAmount: 100 };

  const payment = (overrides: Partial<{ to: string; amount: string; code: string; issuer: string }> = {}) =>
    build(
      USER.publicKey(),
      Operation.payment({
        destination: overrides.to ?? ANCHOR,
        asset: new Asset(overrides.code ?? "USDC", overrides.issuer ?? ISSUER),
        amount: overrides.amount ?? "100.0000000",
      }),
    );

  it("accepts the payment the withdrawal was reserved for", () => {
    expect(() => assertPayment(payment(), USER.publicKey(), expected)).not.toThrow();
  });

  it("rejects a payment routed somewhere other than the anchor", () => {
    const elsewhere = payment({ to: ATTACKER.publicKey() });
    expect(() => assertPayment(elsewhere, USER.publicKey(), expected)).toThrow(/different destination/);
  });

  it("rejects underpaying the anchor, which would leave debt and no cash", () => {
    expect(() => assertPayment(payment({ amount: "1.0000000" }), USER.publicKey(), expected)).toThrow(/pays less/);
  });

  it("rejects paying a look-alike asset from another issuer", () => {
    const wrongIssuer = payment({ issuer: Keypair.random().publicKey() });
    expect(() => assertPayment(wrongIssuer, USER.publicKey(), expected)).toThrow(/different asset/);
  });
});

describe("assertChangeTrust / assertRestoreFootprint", () => {
  it("accepts the operation each step expects", () => {
    const trustline = build(USER.publicKey(), Operation.changeTrust({ asset: new Asset("USDC", ISSUER) }));
    expect(() => assertChangeTrust(trustline, USER.publicKey())).not.toThrow();

    const restore = build(USER.publicKey(), Operation.restoreFootprint({}));
    expect(() => assertRestoreFootprint(restore, USER.publicKey())).not.toThrow();
  });

  it("refuses to submit something else under a trustline or restore step", () => {
    const payment = build(
      USER.publicKey(),
      Operation.payment({ destination: ATTACKER.publicKey(), asset: Asset.native(), amount: "1000" }),
    );
    expect(() => assertChangeTrust(payment, USER.publicKey())).toThrow(TransactionMismatchError);
    expect(() => assertRestoreFootprint(payment, USER.publicKey())).toThrow(TransactionMismatchError);
  });
});

describe("toFixedAmount", () => {
  it("scales to the pool's seven decimals without floating-point drift", () => {
    expect(toFixedAmount(1)).toBe(BigInt(10_000_000));
    expect(toFixedAmount(0.1)).toBe(BigInt(1_000_000));
    expect(toFixedAmount(1234.567)).toBe(BigInt(12_345_670_000));
  });
});
