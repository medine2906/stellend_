# API reference

Every route handler lives under [../app/api/](../app/api/) and is reached at the matching
URL. This page is the map; the handler is always the authority on details.

## Conventions

**Authentication.** Unless a route is marked *public*, it reads the `stellend_session`
cookie and answers `401 {"error": "Not authenticated"}` without one. The session's public
key comes from the anchor's SEP-10 token, never from the request — see
[ARCHITECTURE.md](ARCHITECTURE.md#session-and-identity).

**Errors.** Always `{"error": "<human-readable sentence>"}` with a status:

| Status | Means |
|---|---|
| 400 | The request is malformed or an amount is out of range |
| 401 | No session, or the keeper's bearer token is wrong |
| 403 | Cross-site mutating request, rejected by `proxy.ts` |
| 404 | The referenced row is not the caller's, or a gated feature is not configured |
| 409 | The state has moved on (for example, an advance already on chain) |
| 429 | Rate limited; a `Retry-After` header says for how long |
| 502 | An upstream — anchor, RPC or database — failed |
| 503 | Live market or collateral data is temporarily unavailable |

**Rate limits** (applied in [../proxy.ts](../proxy.ts)): 120 requests per minute per
client across the API, and 12 per minute for `/api/auth/token`, `/api/auth/challenge`,
`/api/deposit`, `/api/loans/borrow/start` and `/api/withdraw`.

**Signing.** Routes ending in `/prepare` return an unsigned XDR string; the matching
`/submit` takes `{ "signedXdr": "..." }` and verifies it before submission. A rejected
transaction answers 400 with the reason from `TransactionMismatchError`.

**Feature gates.** The advance registry routes are gated on
`NEXT_PUBLIC_ADVANCE_REGISTRY_ID`. With no contract id configured they answer
`404 {"error": "Registry feature is not configured"}` before touching the session, so a
deployment without the contract behaves as if the feature does not exist.

## Auth

| Route | Method | Body | Returns |
|---|---|---|---|
| `/api/auth/challenge` | POST *(public)* | `{ account }` | The anchor's SEP-10 challenge transaction |
| `/api/auth/token` | POST *(public)* | `{ transaction, publicKey }` | Sets the session cookie. The claimed `publicKey` is checked against the token and the signed challenge; a mismatch is rejected |
| `/api/auth/me` | GET *(public)* | — | `{ authenticated: false }` or `{ authenticated: true, publicKey }` |
| `/api/auth/logout` | POST | — | `{ success: true }`, cookie cleared |

## Cash advance (borrow)

In the order the flow runs them.

### `POST /api/loans/borrow/start`

Reserves the advance. Takes `{ tryAmount, iban }` — the IBAN is normalised and must be
Turkish (`TR` plus 24 digits), and `tryAmount` must clear the anchor's SEP-6 minimum.
Fetches a SEP-38 quote, opens a SEP-6 withdrawal, and writes the `withdrawals` row that is
**the borrow intent**: every figure and destination each later step is checked against.

Returns `{ withdrawal, usdcAmount }`. Nothing has touched the chain yet.

### The three signatures

Each is a `prepare` then a `submit`, in this order:

| Step | Prepare | Submit body | Notes |
|---|---|---|---|
| Trustline | `POST /api/loans/trustline/prepare` (no body) | `{ signedXdr }` | Skipped when the USDC trustline already exists |
| Collateral | `POST /api/loans/collateral/prepare` `{ asset, amount, decimals? }` | `{ signedXdr, withdrawalId, asset, amount, decimals? }` | `decimals` defaults to 7 |
| Borrow | `POST /api/loans/borrow/prepare` `{ withdrawalId }` | `{ signedXdr, withdrawalId }` | Amount comes from the intent, not the request |
| Payout | `POST /api/loans/borrow/payout/prepare` `{ withdrawalId }` | `{ signedXdr, withdrawalId }` | Pays the borrowed USDC to the anchor with its memo |

**The advance is complete at payout.** Everything below is optional.

### `POST /api/loans/borrow/record/{prepare,submit}` — step 6, optional

Writes the borrower-signed record to the advance registry contract. `prepare` takes
`{ withdrawalId }` and returns `{ unsignedXdr }`; `submit` takes
`{ signedXdr, withdrawalId }` and returns `{ hash }`.

Every argument to the contract is derived server-side from the intent and the loan row —
the client supplies nothing but a signature:

| Contract argument | Derived from |
|---|---|
| `id` | `sha256("stellend-advance-v1\|" + withdrawalId)` |
| `payout_ref` | `sha256("stellend-payout-v1\|" + anchor_ref + "\|" + normalizeIban(iban))` |
| `usdc_amount` | `withdrawals.usdc_amount` → 7-decimal stroops |
| `try_amount` | `withdrawals.try_amount` → 2-decimal minor units |
| `due_at` | `loans.due_at`, as Unix seconds, so the chain matches what the UI showed |

`assertRegistryOpen` then re-checks every one of those by equality before submission.

Refuses with `409` when the payout has not landed, when the intent has no loan row, or when
that loan has no due date. Because the id is content-addressed, a retry rebuilds the same
id and the contract answers `AlreadyExists` — the record you wanted is already there.

### `GET /api/loans/[id]/registry`

The record as the **contract** holds it, read live by simulating `get(borrower, id)`.
Everywhere else the registry appears, the borrower is looking at our cached flag — which is
our word again, the thing the contract exists to stop being the only record.

```
{
  advanceId,                        // hex, the on-chain key
  record: { borrower, usdcAmount, tryAmount, payoutRef,
            openedAt, dueAt, status } | null,
  cached: { registryTx, recordedAt },
  ours:   { usdcAmount, tryAmount, dueAt, status } | null
}
```

`record: null` means **could not be confirmed right now** — an archived entry or an
unreachable RPC lands there too. It is never proof that no record exists, and the UI says
so in those words. `ours` is returned alongside so a disagreement can be shown rather than
smoothed over; amounts are converted back from stroops and minor units, so the two compare
directly.

Scoped to the caller's own profile: a loan id alone never reveals someone else's advance,
even though the record itself is public on chain.

### `POST /api/loans/[id]/registry/close/{prepare,submit}` — optional

Offered after a full repayment: signs `mark_repaid` for the record behind this loan. The
registry key comes from the *withdrawal* id, not the loan id, so the route looks the
withdrawal up first and answers `404` when the loan is not the caller's. `submit` takes
`{ signedXdr }` and caches the hash on `loans.registry_closed_tx`.

`prepare` does not require the record to exist. If it does not, the contract answers
`NotFound` and the submit surfaces it — the chain stays the authority on what is recorded,
not our cache.

### `GET /api/loans/borrow/resume`

Returns `{ pending: null }`, or a `pending` object with `withdrawalId`, `stage`
(`collateral` | `borrow` | `payout` | `settling`), the amounts, the IBAN, the collateral
already posted, `registryRecorded`, and `txs` — the labelled hashes of the steps that have
landed. Only recent, unfinished advances are offered.

`registryEnabled` is returned at the top level on every call, including when there is
nothing pending: the borrow flow reads it on mount to decide whether the optional record
step exists in this deployment at all.

`registryRecorded: false` means the record was declined or not yet attempted. It **never**
gates resume: `borrowStage` does not consider it, because an unrecorded advance is a
complete advance.

### `DELETE /api/loans/borrow/resume`

Body `{ withdrawalId }`. Discards an advance that never reached the chain, so the borrower
can start fresh. Once collateral is locked it answers `409` — that advance has to be
finished or unwound, not dropped.

### `POST /api/loans/quote`

Body `{ tryAmount }`. Returns `{ usdcAmount, quote }` — the SEP-38 quote for a prospective
advance, without reserving anything.

### `GET /api/withdraw/{id}/status`

Polls the anchor's SEP-6 transaction. When the anchor reports the lira sent, the loan flips
to `active`.

## Repayment

| Route | Method | Body | Purpose |
|---|---|---|---|
| `/api/loans/[id]/repay/prepare` | POST | `{ usdcAmount }` | Unsigned pool `repay` |
| `/api/loans/[id]/repay/submit` | POST | `{ signedXdr, settledLoanIds? }` | Submits, then reads the pool to decide which loans are actually settled |
| `/api/loans/[id]/repay/deposit` | POST | `{ tryAmount }` | Buy the USDC to repay with, via a SEP-6 TRY deposit |
| `/api/loans/[id]/repay/deposit/status` | GET | — | Poll that deposit |
| `/api/loans/[id]/collateral/withdraw/prepare` | POST | — | Release collateral once the debt is gone |
| `/api/loans/[id]/collateral/withdraw/submit` | POST | `{ signedXdr }` | |

`settledLoanIds` is a hint, not an instruction: the route confirms against live pool debt
before marking anything repaid.

## Lending (deposit and withdraw liquidity)

| Route | Method | Body | Purpose |
|---|---|---|---|
| `/api/deposit/quote` | POST | `{ tryAmount }` | SEP-38 TRY→USDC quote |
| `/api/deposit` | POST | `{ tryAmount, supplyAsset? }` | Opens a SEP-6 deposit; returns `{ deposit, instructions, quote }`. `supplyAsset: "TRY"` records a TRY-denominated supply |
| `/api/deposit/[id]/simulate` | POST | — | **Mock anchor only** — pretends the bank transfer arrived |
| `/api/deposit/[id]/status` | GET | — | Poll the anchor |
| `/api/deposit/[id]/supply/prepare` | POST | — | Unsigned pool `supply` for the converted USDC |
| `/api/deposit/[id]/supply/submit` | POST | `{ signedXdr }` | |
| `/api/withdraw-liquidity/prepare` | GET | — | What is withdrawable right now |
| `/api/withdraw-liquidity/prepare` | POST | `{ usdcAmount }` | Unsigned pool `withdraw` |
| `/api/withdraw-liquidity/submit` | POST | `{ signedXdr }` | |
| `/api/withdraw` | POST | `{ tryAmount, iban, loanId? }` | Off-ramp USDC to lira through the anchor |

## Reading state

| Route | Method | Returns |
|---|---|---|
| `/api/markets` | GET *(public)* | Live pool reserve: supplied, borrowed, supply/borrow APR and APY, utilisation, caps, collateral and liability factors, oracle price, backstop rate, the rate curve, the ledger it was read at, and the TRY rate |
| `/api/markets/wallet` | GET | The signed-in wallet's position in that market |
| `/api/loans/mine` | GET | `{ loans, debt, collateral, registryEnabled }` — rows plus live pool figures, `Cache-Control: no-store`. Each loan carries `withdrawalId` and `registryRecorded`, so the UI can offer the record after the fact; the registry key derives from the withdrawal id, not the loan id |
| `/api/loans/[id]/health` | GET | `{ health }` from the pool. Read for the caller's own wallet; the id is for routing symmetry only |
| `/api/loans/collateral/options` | GET *(public)* | Assets this pool accepts as collateral |
| `/api/profile` | GET | `{ publicKey, summary, deposits, loans }` |
| `/api/history` | GET | `{ entries, transactions }` across deposits, withdrawals, loans and the tx log |
| `/api/anchor/limits` | GET *(public)* | The anchor's SEP-6 deposit and withdraw limits for USDC |

## Operations

### `GET /api/health` *(public)*

Live status for humans and AI agents: deployed commit (`VERCEL_GIT_COMMIT_SHA`), links to
the rules and docs, reachability of the Soroban RPC and the anchor's `stellar.toml`, and
the configured contract ids. Reports a dead dependency as `false`, never as an error, and
exposes no secret. A static summary for agents is served at `/llms.txt`
([../public/llms.txt](../public/llms.txt)).

### `POST /api/keeper/sync-loans`

Called by a scheduler with `Authorization: Bearer $CRON_SECRET`; `proxy.ts` exempts
`/api/keeper/*` from rate limiting but not from the token check. Reconciles every `active`
and `defaulted` loan against the borrower's live pool position and returns
`{ checked, updated }`.

### `POST /api/loans/restore/submit`

Body `{ signedXdr }`. Submits a state-restoration transaction when Soroban reports an
archived ledger entry (`RestoreRequiredError` from [../lib/blend.ts](../lib/blend.ts)).

## Sandbox

Testnet-only fake bank account, so a demo can show lira arriving and being spent.

| Route | Method | Body | Purpose |
|---|---|---|---|
| `/api/sandbox-account` | GET | — | The linked sandbox IBAN and balance |
| `/api/sandbox-account` | POST | `{ holder? }` | Create one |
| `/api/sandbox-account` | DELETE | — | Unlink it |
| `/api/sandbox-account/spend` | GET | — | Spending history |
| `/api/sandbox-account/spend` | POST | `{ amount, description? }` | Spend from the balance |
