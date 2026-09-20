import "server-only";
import { createHash } from "crypto";
import { Address, Contract, xdr } from "@stellar/stellar-sdk";
import { prepareSorobanTransaction, tryReadContract } from "./blend";
import { normalizeIban } from "./iban";
import { env } from "./env";
import type { WithdrawalRow } from "./database.types";

// ──────────────────────────────────────────────────────────────────────────────
// Feature gate
// ──────────────────────────────────────────────────────────────────────────────

/**
 * True when the advance registry contract is configured. Routes and UI actions
 * check this before touching the contract; no env var = feature silently absent.
 */
export function registryEnabled(): boolean {
  return Boolean(env.NEXT_PUBLIC_ADVANCE_REGISTRY_ID);
}

function getRegistryId(): string {
  const id = env.NEXT_PUBLIC_ADVANCE_REGISTRY_ID;
  if (!id) throw new Error("Advance registry is not configured (NEXT_PUBLIC_ADVANCE_REGISTRY_ID unset)");
  return id;
}

// ──────────────────────────────────────────────────────────────────────────────
// Deterministic identifiers — compatibility surfaces, never change their output
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Content-addressed advance id: sha256("stellend-advance-v1|" + withdrawalId).
 *
 * The domain prefix prevents collisions with any future hash of ours.
 * Determinism is the source of idempotency: a retried step 6 rebuilds the same
 * id, the contract returns AlreadyExists, and the submit route treats that as
 * success — the record we wanted is already there.
 *
 * WARNING: this output is written to an immutable on-chain record and also
 * cached in withdrawals.advance_id. Its behaviour must never change.
 */
export function advanceId(withdrawalId: string): Buffer {
  return createHash("sha256").update(`stellend-advance-v1|${withdrawalId}`).digest();
}

/**
 * Privacy-preserving reference to the fiat leg: sha256 of the anchor ref and
 * the normalised IBAN. The IBAN is personal data and must never appear on a
 * public ledger; a borrower holding the originals can reproduce this hash to
 * prove which payout a record covers.
 *
 * WARNING: depends on normalizeIban's output. That function's normalisation
 * behaviour is a compatibility surface — if it changes, old records stop
 * verifying. Any change there must be coordinated with this function.
 */
export function payoutRef(anchorRef: string, iban: string): Buffer {
  const normalised = normalizeIban(iban);
  if (!normalised) throw new Error(`Cannot compute payout_ref: '${iban}' is not a valid TR IBAN`);
  return createHash("sha256").update(`stellend-payout-v1|${anchorRef}|${normalised}`).digest();
}

// ──────────────────────────────────────────────────────────────────────────────
// Amount conversions — two different scales in adjacent arguments is a latent
// bug; keep both here and never inline them at a call site.
// ──────────────────────────────────────────────────────────────────────────────

/** USDC amount → Soroban i128 in 7-decimal stroops (same unit as the pool). */
export function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * 10 ** 7));
}

/**
 * TRY amount → Soroban i128 in 2-decimal minor units (kuruş).
 *
 * Note: tryAmount in the DB is stored with 2 decimal places already (e.g.
 * 5000.00), so this is multiplication by 100, not 10^7.
 */
export function tryToMinorUnits(tryAmount: number): bigint {
  return BigInt(Math.round(tryAmount * 100));
}

// ──────────────────────────────────────────────────────────────────────────────
// Transaction builders
// ──────────────────────────────────────────────────────────────────────────────

function bufToScVal(buf: Buffer): xdr.ScVal {
  // BytesN<32> in Soroban XDR is ScVal.scvBytes with exactly 32 bytes.
  return xdr.ScVal.scvBytes(buf);
}

function bigintToScVal(n: bigint): xdr.ScVal {
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString(String(n >> 64n)),
      lo: xdr.Uint64.fromString(String(n & 0xffff_ffff_ffff_ffffn)),
    }),
  );
}

function u64ToScVal(n: bigint): xdr.ScVal {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n)));
}

/**
 * Builds the unsigned `open` transaction for step 6 of the borrow flow.
 *
 * Every argument is server-derived from the withdrawal intent; the client
 * supplies nothing but its signature. assertRegistryOpen in txguard.ts
 * verifies all fields before submit.
 *
 * @param dueAtUnix Unix timestamp (seconds) of loans.due_at — pass
 *   Math.floor(new Date(loan.due_at).getTime() / 1000) from the loan row.
 */
export async function buildOpenTransaction(
  account: string,
  intent: WithdrawalRow,
  dueAtUnix: number,
): Promise<string> {
  if (!intent.anchor_ref) throw new Error("Intent has no anchor_ref — cannot compute payout_ref");

  const id = advanceId(intent.id);
  const ref = payoutRef(intent.anchor_ref, intent.iban);
  const usdc = usdcToStroops(intent.usdc_amount);
  const tryAmt = tryToMinorUnits(intent.try_amount);
  const dueAt = BigInt(dueAtUnix);

  const contract = new Contract(getRegistryId());
  const operation = contract.call(
    "open",
    xdr.ScVal.scvAddress(Address.fromString(account).toScAddress()),
    bufToScVal(id),
    bigintToScVal(usdc),
    bigintToScVal(tryAmt),
    bufToScVal(ref),
    u64ToScVal(dueAt),
  );

  return prepareSorobanTransaction(account, operation as unknown as xdr.Operation);
}

/**
 * Builds the unsigned `mark_repaid` transaction offered after a full repayment.
 *
 * `withdrawalId` is the borrow intent's id; `advanceId()` derives the same
 * on-chain id that `buildOpenTransaction` used.
 */
export async function buildMarkRepaidTransaction(account: string, withdrawalId: string): Promise<string> {
  const id = advanceId(withdrawalId);
  const contract = new Contract(getRegistryId());
  const operation = contract.call(
    "mark_repaid",
    xdr.ScVal.scvAddress(Address.fromString(account).toScAddress()),
    bufToScVal(id),
  );
  return prepareSorobanTransaction(account, operation as unknown as xdr.Operation);
}

/**
 * Whether this borrower already has this advance recorded on chain.
 *
 * Used for one thing: reading a failed submission. A retried `open` fails inside the
 * contract with AlreadyExists, which is the state we wanted all along, and this is how the
 * submit route tells that apart from a submission that failed for some other reason.
 *
 * False means "not confirmed", never "definitely absent" — an archived entry or an RPC that
 * cannot answer lands here too — so a false answer only ever leaves the original failure in
 * place, and never causes anything to be written down as recorded.
 */
export async function advanceRecordExists(borrower: string, withdrawalId: string): Promise<boolean> {
  const result = await tryReadContract(getRegistryId(), "get", [
    xdr.ScVal.scvAddress(Address.fromString(borrower).toScAddress()),
    bufToScVal(advanceId(withdrawalId)),
  ]);
  return result.ok;
}

// ──────────────────────────────────────────────────────────────────────────────
// Reading the record back
// ──────────────────────────────────────────────────────────────────────────────

/** An advance as the contract holds it, in the units a UI can display. */
export interface AdvanceRecord {
  borrower: string;
  /** Converted back from stroops / minor units, so these compare directly with our rows. */
  usdcAmount: number;
  tryAmount: number;
  /** Hex, for a borrower who wants to recompute it from their own anchor ref and IBAN. */
  payoutRef: string;
  openedAt: string;
  dueAt: string;
  status: "open" | "repaid";
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

function toHex(value: unknown): string | null {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "string") return value;
  return null;
}

function secondsToIso(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString();
}

/**
 * Decodes the `Advance` struct a simulated `get` returns.
 *
 * Exported for its own tests, and written defensively on purpose: this is the one place
 * where a value the contract owns crosses into our types. A shape we do not recognise
 * returns null — a record shown with a wrong number would be worse than no record, because
 * the whole point of this page is that the chain disagrees with nobody.
 */
export function decodeAdvance(value: unknown): AdvanceRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const usdc = toBigInt(raw.usdc_amount);
  const tryAmt = toBigInt(raw.try_amount);
  const openedAt = toBigInt(raw.opened_at);
  const dueAt = toBigInt(raw.due_at);
  const payoutRef = toHex(raw.payout_ref);
  const status = toBigInt(raw.status);

  if (usdc == null || tryAmt == null || openedAt == null || dueAt == null) return null;
  if (payoutRef == null || typeof raw.borrower !== "string") return null;
  // Status is a unit enum with explicit discriminants, so it arrives as 0 or 1. Anything
  // else means a contract newer than this code, and guessing at it would be a lie.
  if (status !== 0n && status !== 1n) return null;

  return {
    borrower: raw.borrower,
    usdcAmount: Number(usdc) / 10 ** 7,
    tryAmount: Number(tryAmt) / 100,
    payoutRef,
    openedAt: secondsToIso(openedAt),
    dueAt: secondsToIso(dueAt),
    status: status === 0n ? "open" : "repaid",
  };
}

/**
 * The record as the chain holds it, or null when it cannot be confirmed right now.
 *
 * Null is never proof of absence — an archived entry or an RPC that cannot answer lands
 * here too. Callers must present it as "could not read", not as "you never signed one".
 */
export async function readAdvanceRecord(borrower: string, withdrawalId: string): Promise<AdvanceRecord | null> {
  const result = await tryReadContract(getRegistryId(), "get", [
    xdr.ScVal.scvAddress(Address.fromString(borrower).toScAddress()),
    bufToScVal(advanceId(withdrawalId)),
  ]);
  return result.ok ? decodeAdvance(result.value) : null;
}
