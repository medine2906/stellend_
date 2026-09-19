import "server-only";
import { requireEnv } from "./env";

const ANCHOR_TIMEOUT_MS = 20_000;

/** fetch() with a hard timeout — an unresponsive anchor should fail loudly, not hang the request forever. */
function anchorFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ANCHOR_TIMEOUT_MS) });
}

export interface AnchorConfig {
  webAuthEndpoint: string;
  transferServer: string;
  quoteServer: string;
  signingKey: string | null;
}

let cachedConfig: AnchorConfig | null = null;

/** Extracts a top-level `KEY = "value"` entry from a stellar.toml document's text. */
export function pickTomlValue(text: string, key: string): string | null {
  return text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1] ?? null;
}

/**
 * The anchor URL's `.well-known/stellar.toml` is the canonical source for its
 * SEP-10/SEP-6 endpoints, but this network sandbox cannot reach
 * tr-mock-anchor.fly.dev to verify its exact layout. We attempt the TOML
 * fetch (works in any real deployment) and fall back to the endpoint paths
 * used by the standard Stellar anchor reference server if it's unreachable.
 */
export async function getAnchorConfig(): Promise<AnchorConfig> {
  if (cachedConfig) return cachedConfig;

  const anchorUrl = requireEnv("NEXT_PUBLIC_ANCHOR_URL");
  const fallback: AnchorConfig = {
    webAuthEndpoint: `${anchorUrl}/auth`,
    transferServer: `${anchorUrl}/sep6`,
    quoteServer: `${anchorUrl}/sep38`,
    signingKey: null,
  };

  try {
    const res = await anchorFetch(`${anchorUrl}/.well-known/stellar.toml`, {
      cache: "force-cache",
      next: { revalidate: 3600 },
    });
    if (!res.ok) return (cachedConfig = fallback);

    const text = await res.text();
    const pick = (key: string) => pickTomlValue(text, key);

    cachedConfig = {
      webAuthEndpoint: pick("WEB_AUTH_ENDPOINT") ?? fallback.webAuthEndpoint,
      transferServer: pick("TRANSFER_SERVER") ?? fallback.transferServer,
      quoteServer: pick("ANCHOR_QUOTE_SERVER") ?? fallback.quoteServer,
      signingKey: pick("SIGNING_KEY"),
    };
    return cachedConfig;
  } catch {
    return (cachedConfig = fallback);
  }
}

export interface Sep10ChallengeResponse {
  transaction: string;
  network_passphrase: string;
}

/** SEP-10 step 1: request a signed challenge transaction for the given account. */
export async function requestSep10Challenge(account: string): Promise<Sep10ChallengeResponse> {
  const { webAuthEndpoint } = await getAnchorConfig();
  const url = new URL(webAuthEndpoint);
  url.searchParams.set("account", account);

  const res = await anchorFetch(url.toString());
  if (!res.ok) {
    throw new Error(`Anchor SEP-10 challenge failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface Sep10TokenResponse {
  token: string;
}

/** SEP-10 step 2: exchange the user-signed challenge transaction for a session JWT. */
export async function submitSep10Challenge(signedTransactionXdr: string): Promise<Sep10TokenResponse> {
  const { webAuthEndpoint } = await getAnchorConfig();

  const res = await anchorFetch(webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedTransactionXdr }),
  });
  if (!res.ok) {
    throw new Error(`Anchor SEP-10 token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function authHeaders(jwt: string): HeadersInit {
  return { Authorization: `Bearer ${jwt}` };
}

/** This anchor's SEP-6 endpoints reject amounts with more than 2 decimal places. */
export function formatAnchorAmount(amount: string | number): string {
  return Number(amount).toFixed(2);
}

async function assertOk(res: Response, label: string) {
  if (!res.ok) {
    throw new Error(`Anchor ${label} failed: ${res.status} ${await res.text()}`);
  }
}

export interface Sep38QuoteRequest {
  jwt: string;
  sellAsset: string;
  buyAsset: string;
  /** Exactly one of sellAmount / buyAmount must be provided, per SEP-38. */
  sellAmount?: string;
  buyAmount?: string;
  context?: "sep6" | "sep31";
}

export interface Sep38QuoteResponse {
  id: string;
  expires_at: string;
  price: string;
  sell_asset: string;
  sell_amount: string;
  buy_asset: string;
  buy_amount: string;
  fee: { total: string; asset: string };
}

/** SEP-38: request a firm, lockable quote for a TRY <-> USDC conversion. */
export async function getSep38Quote(req: Sep38QuoteRequest): Promise<Sep38QuoteResponse> {
  const { quoteServer } = await getAnchorConfig();

  const res = await anchorFetch(`${quoteServer}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(req.jwt) },
    body: JSON.stringify({
      sell_asset: req.sellAsset,
      buy_asset: req.buyAsset,
      sell_amount: req.sellAmount,
      buy_amount: req.buyAmount,
      context: req.context ?? "sep6",
    }),
  });
  await assertOk(res, "SEP-38 quote");
  return res.json();
}

export interface Sep6DepositRequest {
  jwt: string;
  account: string;
  assetCode: string;
  amount?: string;
  quoteId?: string;
}

export interface Sep6InstructionField {
  value: string;
  description: string;
}

export interface Sep6DepositResponse {
  id: string;
  how?: string;
  instructions?: Record<string, Sep6InstructionField>;
  eta?: number;
  min_amount?: number;
  max_amount?: number;
}

/** SEP-6 deposit: returns the anchor transaction id and bank transfer instructions. */
export async function startSep6Deposit(req: Sep6DepositRequest): Promise<Sep6DepositResponse> {
  const { transferServer } = await getAnchorConfig();

  const url = new URL(`${transferServer}/deposit`);
  url.searchParams.set("asset_code", req.assetCode);
  url.searchParams.set("account", req.account);
  if (req.amount) url.searchParams.set("amount", formatAnchorAmount(req.amount));
  if (req.quoteId) url.searchParams.set("quote_id", req.quoteId);

  const res = await anchorFetch(url.toString(), { headers: authHeaders(req.jwt) });
  await assertOk(res, "SEP-6 deposit");
  return res.json();
}

/**
 * Sandbox only: tells the mock anchor that the user's TRY bank transfer
 * arrived, so it goes on to pay out the USDC. A real anchor has no such
 * endpoint; there the bank transfer itself moves the deposit forward.
 */
export async function simulateSep6BankTransfer(jwt: string, id: string, tryAmount: string | number): Promise<void> {
  const { transferServer } = await getAnchorConfig();

  const res = await anchorFetch(`${transferServer}/tx/${encodeURIComponent(id)}/simulate-bank-transfer`, {
    method: "POST",
    headers: { ...authHeaders(jwt), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: formatAnchorAmount(tryAmount) }),
  });
  // A repeat click (or a retry) hits an already-funded deposit; the goal is met.
  if (res.status === 409 && (await res.clone().text()).includes("already_funded")) return;
  await assertOk(res, "simulate bank transfer");
}

export interface Sep6WithdrawRequest {
  jwt: string;
  account: string;
  assetCode: string;
  amount?: string;
  quoteId?: string;
  /** Destination bank account (IBAN) for the TR mock anchor's "bank_account" withdrawal type. */
  dest: string;
}

export interface Sep6WithdrawResponse {
  id: string;
  account_id: string;
  memo_type?: "text" | "id" | "hash";
  memo?: string;
  eta?: number;
  min_amount?: number;
  max_amount?: number;
}

/** SEP-6 withdraw: returns the anchor's Stellar account + memo to send the borrowed USDC to. */
export async function startSep6Withdraw(req: Sep6WithdrawRequest): Promise<Sep6WithdrawResponse> {
  const { transferServer } = await getAnchorConfig();

  const url = new URL(`${transferServer}/withdraw`);
  url.searchParams.set("asset_code", req.assetCode);
  url.searchParams.set("account", req.account);
  url.searchParams.set("type", "bank_account");
  url.searchParams.set("dest", req.dest);
  if (req.amount) url.searchParams.set("amount", formatAnchorAmount(req.amount));
  if (req.quoteId) url.searchParams.set("quote_id", req.quoteId);

  const res = await anchorFetch(url.toString(), { headers: authHeaders(req.jwt) });
  await assertOk(res, "SEP-6 withdraw");
  return res.json();
}

export type Sep6TransactionStatus =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_user_transfer_complete"
  | "pending_external"
  | "pending_anchor"
  | "pending_stellar"
  | "pending_trust"
  | "pending_user"
  | "no_market"
  | "too_small"
  | "too_large"
  | "error"
  | "completed"
  | "refunded"
  | "expired";

export interface Sep6Transaction {
  id: string;
  kind: "deposit" | "withdrawal";
  status: Sep6TransactionStatus;
  status_eta?: number;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  more_info_url?: string;
}

/** SEP-6: poll the current status of a previously started deposit/withdraw transaction. */
export async function getSep6Transaction(jwt: string, id: string): Promise<Sep6Transaction> {
  const { transferServer } = await getAnchorConfig();

  const url = new URL(`${transferServer}/transaction`);
  url.searchParams.set("id", id);

  const res = await anchorFetch(url.toString(), { headers: authHeaders(jwt) });
  await assertOk(res, "SEP-6 transaction status");
  const { transaction } = await res.json();
  return transaction;
}

export interface Sep6AssetInfo {
  enabled: boolean;
  min_amount?: number;
  max_amount?: number;
}

export interface Sep6InfoResponse {
  deposit?: Record<string, Sep6AssetInfo>;
  withdraw?: Record<string, Sep6AssetInfo>;
}

let cachedInfo: Sep6InfoResponse | null = null;

/** SEP-6 `/info`: public, unauthenticated — per-asset min/max amounts and enabled flags. */
export async function getSep6Info(): Promise<Sep6InfoResponse> {
  if (cachedInfo) return cachedInfo;
  const { transferServer } = await getAnchorConfig();

  const res = await anchorFetch(`${transferServer}/info`);
  await assertOk(res, "SEP-6 info");
  return (cachedInfo = await res.json());
}

/**
 * Throws a clear, user-facing error if `amount` falls outside the anchor's
 * declared minimum for the given asset+direction (no maximum is enforced) — catches obviously-doomed
 * requests before spending a round trip (or a wallet signature) on them.
 * Silently allows the amount through if the anchor doesn't declare limits
 * for that asset (some anchors only fill in a subset of fields).
 */
export async function assertWithinSep6Limits(
  direction: "deposit" | "withdraw",
  assetCode: string,
  amount: number,
): Promise<void> {
  const info = await getSep6Info();
  const assetInfo = info[direction]?.[assetCode];
  if (!assetInfo) return;

  if (assetInfo.enabled === false) {
    throw new Error(`${assetCode} ${direction}s are not currently enabled by the anchor`);
  }
  if (assetInfo.min_amount != null && amount < assetInfo.min_amount) {
    throw new Error(`Amount below the anchor's minimum of ${assetInfo.min_amount}`);
  }
}
