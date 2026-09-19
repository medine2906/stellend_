import { TransactionBuilder } from "@stellar/stellar-sdk";
import { STELLAR_NETWORK } from "./stellar";

/** Base account of a SEP-10 `sub` claim, which may carry a `:<memo>` suffix for muxed-style accounts. */
export function subjectAccount(sub: string): string {
  return sub.split(":")[0];
}

/** Reads the claims of a JWT without verifying its signature (the token came straight from the anchor over TLS). */
export function decodeJwtClaims(jwt: string): { sub?: string; exp?: number } | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * The account a SEP-10 challenge transaction authenticates: its first operation is a
 * `manageData` whose source is the client account.
 */
export function challengeClientAccount(signedChallengeXdr: string): string | null {
  try {
    const tx = TransactionBuilder.fromXDR(signedChallengeXdr, STELLAR_NETWORK);
    const op = "operations" in tx ? tx.operations[0] : undefined;
    if (!op || op.type !== "manageData") return null;
    return op.source ?? null;
  } catch {
    return null;
  }
}

export class Sep10MismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Sep10MismatchError";
  }
}

/**
 * Login must authenticate exactly the account the client claims. Without this, anyone could
 * complete a SEP-10 challenge for their own key and then ask for a session as somebody else's.
 * The returned account comes from the JWT the anchor issued, never from the request body.
 */
export function assertSessionMatchesToken(claimedPublicKey: string, jwt: string, signedChallengeXdr: string, now = Date.now()): string {
  const claims = decodeJwtClaims(jwt);
  if (!claims?.sub) throw new Sep10MismatchError("Anchor returned a token without a subject");
  if (claims.exp && claims.exp * 1000 <= now) throw new Sep10MismatchError("Anchor token is already expired");

  const account = subjectAccount(claims.sub);
  if (account !== claimedPublicKey) throw new Sep10MismatchError("Token does not belong to the claimed account");

  const challengeAccount = challengeClientAccount(signedChallengeXdr);
  if (challengeAccount !== claimedPublicKey) throw new Sep10MismatchError("Challenge was not issued for the claimed account");
  return account;
}
