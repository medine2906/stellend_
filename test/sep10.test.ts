import { describe, expect, it } from "vitest";
import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { assertSessionMatchesToken, challengeClientAccount, decodeJwtClaims, Sep10MismatchError, subjectAccount } from "@/lib/sep10";

const CLIENT = Keypair.random();
const ATTACKER = Keypair.random();
const SERVER = Keypair.random();

/** A SEP-10 challenge: server-sourced transaction whose first operation is sourced by the client. */
function challengeFor(clientAccount: string): string {
  const tx = new TransactionBuilder(new Account(SERVER.publicKey(), "-1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.manageData({ name: "stellend auth", value: "abcd", source: clientAccount }),
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

function jwtFor(sub: string, exp = Math.floor(Date.now() / 1000) + 3600): string {
  const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub, exp })}.signature`;
}

describe("decodeJwtClaims", () => {
  it("reads the subject and expiry of a token", () => {
    expect(decodeJwtClaims(jwtFor(CLIENT.publicKey()))?.sub).toBe(CLIENT.publicKey());
  });

  it("returns null for anything that is not a three-part token", () => {
    expect(decodeJwtClaims("not-a-jwt")).toBeNull();
    expect(decodeJwtClaims("a.b")).toBeNull();
  });
});

describe("subjectAccount", () => {
  it("strips the memo suffix SEP-10 allows on a subject", () => {
    expect(subjectAccount(`${CLIENT.publicKey()}:12345`)).toBe(CLIENT.publicKey());
  });
});

describe("challengeClientAccount", () => {
  it("reads the account a challenge authenticates from its first operation", () => {
    expect(challengeClientAccount(challengeFor(CLIENT.publicKey()))).toBe(CLIENT.publicKey());
  });

  it("returns null for a transaction that is not a challenge", () => {
    const tx = new TransactionBuilder(new Account(SERVER.publicKey(), "1"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: "100" }))
      .setTimeout(300)
      .build();
    expect(challengeClientAccount(tx.toXDR())).toBeNull();
  });
});

describe("assertSessionMatchesToken", () => {
  it("accepts a token and challenge that both belong to the claimed account", () => {
    expect(
      assertSessionMatchesToken(CLIENT.publicKey(), jwtFor(CLIENT.publicKey()), challengeFor(CLIENT.publicKey())),
    ).toBe(CLIENT.publicKey());
  });

  it("rejects a token issued for somebody else — the account-takeover case", () => {
    // The attacker completed a real SEP-10 flow for their own key, then asked for a
    // session as the victim.
    expect(() =>
      assertSessionMatchesToken(CLIENT.publicKey(), jwtFor(ATTACKER.publicKey()), challengeFor(ATTACKER.publicKey())),
    ).toThrow(Sep10MismatchError);
  });

  it("rejects a challenge that authenticates a different account than the token", () => {
    expect(() =>
      assertSessionMatchesToken(CLIENT.publicKey(), jwtFor(CLIENT.publicKey()), challengeFor(ATTACKER.publicKey())),
    ).toThrow(Sep10MismatchError);
  });

  it("rejects an expired token", () => {
    const expired = jwtFor(CLIENT.publicKey(), Math.floor(Date.now() / 1000) - 1);
    expect(() => assertSessionMatchesToken(CLIENT.publicKey(), expired, challengeFor(CLIENT.publicKey()))).toThrow(
      Sep10MismatchError,
    );
  });

  it("rejects a token with no subject at all", () => {
    const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const noSub = `${part({ alg: "none" })}.${part({ exp: 9999999999 })}.sig`;
    expect(() => assertSessionMatchesToken(CLIENT.publicKey(), noSub, challengeFor(CLIENT.publicKey()))).toThrow(
      Sep10MismatchError,
    );
  });
});
