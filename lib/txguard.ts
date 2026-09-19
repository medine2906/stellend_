import { Address, Asset, Transaction, TransactionBuilder, scValToNative, xdr } from "@stellar/stellar-sdk";
import { RequestType } from "@blend-capital/blend-sdk";
import { STELLAR_NETWORK } from "./stellar";

/**
 * A signed transaction the server is asked to submit did not match what the flow
 * says it should be. The user signed it, so it can only ever spend their own funds —
 * but our off-chain records are written from these submissions, so a mismatch here
 * would let a client log a loan that does not reflect the chain.
 */
export class TransactionMismatchError extends Error {
  constructor(message: string) {
    super(`Refusing to submit this transaction: ${message}`);
    this.name = "TransactionMismatchError";
  }
}

type ParsedOperation = Transaction["operations"][number];

function parse(signedXdr: string): Transaction {
  let tx;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, STELLAR_NETWORK);
  } catch {
    throw new TransactionMismatchError("it is not a valid transaction for this network");
  }
  // A fee-bump wrapper would let the inner transaction be anything we did not inspect.
  if (!(tx instanceof Transaction)) throw new TransactionMismatchError("fee-bump transactions are not accepted");
  return tx;
}

/** The single operation of a transaction whose source must be `account`. */
function singleOperation(signedXdr: string, account: string): ParsedOperation {
  const tx = parse(signedXdr);
  if (tx.source !== account) {
    throw new TransactionMismatchError("it is sent from a different account than the signed-in wallet");
  }
  if (tx.operations.length !== 1) {
    throw new TransactionMismatchError(`it bundles ${tx.operations.length} operations, expected exactly 1`);
  }
  const op = tx.operations[0];
  // An operation with its own source could act on behalf of another account entirely.
  if (op.source && op.source !== account) {
    throw new TransactionMismatchError("its operation is sourced from a different account");
  }
  return op;
}

export interface PoolRequest {
  requestType: RequestType;
  address: string;
  amount: bigint;
}

/**
 * Decodes a signed Blend `submit` invocation, checking it targets our pool and acts
 * only on the signed-in wallet (`from`/`spender`/`to` are all the user).
 */
export function decodePoolSubmit(signedXdr: string, account: string, poolId: string): PoolRequest[] {
  const op = singleOperation(signedXdr, account);
  if (op.type !== "invokeHostFunction") {
    throw new TransactionMismatchError(`it is a ${op.type} operation, expected a contract call`);
  }

  // The other host functions (uploading or creating a contract) carry no invocation to check.
  if (op.func.type !== "hostFunctionTypeInvokeContract") {
    throw new TransactionMismatchError("it is not a contract invocation");
  }
  const invocation = op.func.invokeContract;

  const contractId = Address.fromScAddress(invocation.contractAddress).toString();
  if (contractId !== poolId) {
    throw new TransactionMismatchError(`it calls contract ${contractId}, not the lending pool`);
  }
  const fn = invocation.functionName.toString();
  if (fn !== "submit") {
    throw new TransactionMismatchError(`it calls '${fn}', not 'submit'`);
  }

  const args = invocation.args.map((arg: xdr.ScVal) => scValToNative(arg));
  const [from, spender, to, requests] = args;
  if (from !== account || spender !== account || to !== account) {
    throw new TransactionMismatchError("it moves funds for an account other than the signed-in wallet");
  }
  if (!Array.isArray(requests)) {
    throw new TransactionMismatchError("its request list could not be decoded");
  }

  return requests.map((r: { request_type: unknown; address: unknown; amount: unknown }) => ({
    requestType: Number(r.request_type) as RequestType,
    address: String(r.address),
    amount: BigInt(r.amount as string | number | bigint),
  }));
}

/** Converts a decimal amount to the pool's fixed-point integer representation. */
export function toFixedAmount(amount: number, decimals = 7): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

/**
 * Asserts the signed pool call performs exactly the expected action on the expected
 * asset, within the given bounds. Bounds are one-sided per flow: a step that records
 * what the user put in checks a floor, a step that records what they took out checks
 * a ceiling.
 */
export function assertPoolRequest(
  signedXdr: string,
  account: string,
  poolId: string,
  expected: { requestType: RequestType; asset: string; minAmount?: bigint; maxAmount?: bigint },
): PoolRequest {
  const requests = decodePoolSubmit(signedXdr, account, poolId);
  if (requests.length !== 1) {
    throw new TransactionMismatchError(`it contains ${requests.length} pool requests, expected exactly 1`);
  }
  const [request] = requests;
  if (request.requestType !== expected.requestType) {
    throw new TransactionMismatchError("it is a different pool action than the one this step performs");
  }
  if (request.address !== expected.asset) {
    throw new TransactionMismatchError("it acts on a different asset than the one requested");
  }
  if (expected.minAmount != null && request.amount < expected.minAmount) {
    throw new TransactionMismatchError("its amount is smaller than the amount this step was quoted for");
  }
  if (expected.maxAmount != null && request.amount > expected.maxAmount) {
    throw new TransactionMismatchError("its amount is larger than the amount this step was quoted for");
  }
  return request;
}

/** Asserts the signed transaction is a classic payment of `asset` to `to`, for at least `minAmount`. */
export function assertPayment(
  signedXdr: string,
  account: string,
  expected: { to: string; assetCode: string; assetIssuer: string; minAmount: number },
) {
  const op = singleOperation(signedXdr, account);
  if (op.type !== "payment") {
    throw new TransactionMismatchError(`it is a ${op.type} operation, expected a payment`);
  }
  if (op.destination !== expected.to) {
    throw new TransactionMismatchError("it pays a different destination than the anchor's account");
  }
  const asset = op.asset as Asset;
  if (asset.getCode() !== expected.assetCode || asset.getIssuer() !== expected.assetIssuer) {
    throw new TransactionMismatchError("it pays a different asset than the one the anchor expects");
  }
  if (Number(op.amount) < expected.minAmount) {
    throw new TransactionMismatchError("it pays less than the amount the withdrawal was reserved for");
  }
}

/** Asserts the signed transaction only establishes a trustline from the signed-in wallet. */
export function assertChangeTrust(signedXdr: string, account: string) {
  const op = singleOperation(signedXdr, account);
  if (op.type !== "changeTrust") {
    throw new TransactionMismatchError(`it is a ${op.type} operation, expected a trustline change`);
  }
}

/** Asserts the signed transaction only restores expired ledger entries. */
export function assertRestoreFootprint(signedXdr: string, account: string) {
  const op = singleOperation(signedXdr, account);
  if (op.type !== "restoreFootprint") {
    throw new TransactionMismatchError(`it is a ${op.type} operation, expected a footprint restore`);
  }
}
