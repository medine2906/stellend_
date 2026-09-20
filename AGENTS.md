<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Stellend (repo dir: `p2pcash`) — instructions for AI agents

Read this file first, then [README.md](README.md) (product, flows, limits) and
[docs/README.md](docs/README.md) (index of deeper docs). This file holds the rules and
commands; the README holds the reasoning. If they conflict, the code wins, then this file.

## What this project is

Turkish lira in and out of a Stellar lending pool, non-custodially.

- **Borrower:** locks a Soroban asset as collateral, borrows USDC from a Blend v2 pool, the
  anchor pays TRY to their IBAN.
- **Lender:** sends TRY by bank transfer, the anchor converts it to USDC, it is supplied to
  the same pool.
- **Status: testnet proof of concept.** Stellar testnet, Blend testnet pool, mock TRY anchor
  (`tr-mock-anchor.fly.dev`). Never point anything at mainnet.

Stack: Next.js 16 (App Router, React 19, Tailwind 4), TypeScript, `@stellar/stellar-sdk`,
`@blend-capital/blend-sdk`, Stellar Wallets Kit, Supabase (Postgres), zod, Vitest, and one
Rust/Soroban contract in `contracts/`.

## Hard rules — do not break these without asking the user

1. **No server-held keys.** The server never owns a Stellar secret key or keypair, not even a
   fee-paying "keeper". The server *prepares unsigned XDR*; the user's wallet signs; the
   server *verifies and submits*. Anything else the protocol needs is either signed by a
   user wallet or left to external actors, with the gap documented.
2. **Stay on the mock anchor.** Do not add a production TRY anchor integration and do not
   implement SEP-12 KYC. Keep anchor endpoints discovered from `stellar.toml` so switching
   is an env change. Keep the "testnet proof of concept" framing honest.
3. **The chain is authoritative; Supabase is a cache** (the one exception is the borrow
   intent row, which the server writes and later steps check against). Where they disagree,
   prefer the chain.
4. **Never trust amounts or identity from the client.**
   - Identity comes from the session (`getSession()` → `session.publicKey`), which is bound to
     the anchor's SEP-10 token ([lib/sep10.ts](lib/sep10.ts)), never from the request body.
   - Amounts, destinations and dates are read from the server's own reserved intent
     ([lib/borrowIntent.ts](lib/borrowIntent.ts)).
   - Every signed transaction goes through [lib/txguard.ts](lib/txguard.ts) (decode + verify
     source, contract, action, amount bound) **before** submission. A new submit route needs a
     new guard and a test for it.
5. **The advance registry is optional and never a gate.** The advance is complete at payout.
   `borrowStage` must not depend on the registry. The whole feature is gated on
   `NEXT_PUBLIC_ADVANCE_REGISTRY_ID`; absent → routes answer 404.
6. **The registry contract has no admin key**, holds no funds, enforces nothing, and stores a
   hash of the IBAN, never the IBAN. Do not add an operator role, a `void`, or PII to it
   without asking.
7. **Do not present a perpetual Blend position as a term loan.** `due_at` is a signed target
   date, not a deadline. UI copy must not imply enforcement.

## Commands

```bash
npm install
cp .env.example .env.local      # then fill in Supabase values
npm run dev                     # http://localhost:3000
npm run typecheck               # tsc --noEmit
npm run lint                    # eslint
npm test                        # vitest run (test/**/*.test.ts, no network)
npm run build                   # CI builds with only the NEXT_PUBLIC_* ids set
DATABASE_URL=... npm run db:apply            # supabase/schema.sql, then supabase/migrations/*
npm run db:apply -- --dry-run                # print SQL instead of running

cd contracts && cargo test                   # contract tests, native
cd contracts && stellar contract build       # needs stellar-cli 25.2+ and wasm32v1-none
```

**Definition of done for any code change:** `npm run typecheck`, `npm run lint` and
`npm test` all pass (that is exactly what CI runs, plus `build` and the contract job). If you
touched `contracts/`, run `cargo test` too. Say so plainly if you could not run something.

## Repository map

```
app/                 Next.js App Router. Pages: dashboard/{borrow,lend,repay,history,profile},
                     markets/[symbol], sandbox
app/api/**/route.ts  Route handlers. On-chain actions come as prepare/submit pairs
components/          Client flows: BorrowFlow, DepositFlow, RepayFlow, WithdrawFundsFlow, ...
lib/blend.ts         Builds/submits Blend pool txs, reads positions; RestoreRequiredError
lib/anchor.ts        SEP-10 auth, SEP-6 deposit/withdraw, SEP-38 quotes
lib/sep10.ts         Session identity from the anchor's token
lib/session.ts       AES-256-GCM session cookie (carries the anchor bearer token)
lib/txguard.ts       Decode + verify signed transactions before submit
lib/borrowIntent.ts  Reserved "borrow intent": the server's source of truth for amounts
lib/registry.ts      Client for the advance-registry contract
lib/liquidity.ts     Pure logic: utilisation caps, loan timing, position risk
lib/env.ts           zod-validated env, parsed lazily; requireEnv() where a value is mandatory
lib/errors.ts        getErrorMessage(err, fallback)
lib/ratelimit.ts     Used by proxy.ts
lib/supabase.ts      Service-role client (server only); lib/database.types.ts are its types
proxy.ts             Next 16 "proxy" (the former middleware): origin check + rate limit on /api/*
supabase/schema.sql  Full current schema; supabase/migrations/ for non-idempotent changes
contracts/advance-registry/  Our Soroban contract (Rust, soroban-sdk 28)
test/                Vitest; helpers/supabaseMock.ts, stubs/server-only.ts
docs/                ARCHITECTURE, API, DATA-MODEL, PRD, BUSINESS-MODEL, ECOSYSTEM, ...
```

## The borrow flow in one screen

`start` (SEP-38 quote + SEP-6 withdraw, writes the intent) → `trustline` (if missing) →
`collateral` → `borrow` → `payout` (USDC to the anchor; **advance complete**) → optional
`record` (registry `open`) → anchor pays TRY → `/api/withdraw/[id]/status` flips the loan to
`active`. Every step after `start` is a prepare/submit pair signed by the wallet.
`GET /api/loans/borrow/resume` reports where an interrupted flow stopped. Full detail:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), routes: [docs/API.md](docs/API.md).

## Conventions (match the existing code)

- **Route handlers** follow one shape: `getSession()` → 401 `{ error: "Not authenticated" }`;
  `req.json().catch(() => null)` then validate → 400 `{ error }`; not found → 404; conflict →
  409; upstream/chain failure → 502 with `getErrorMessage(err, "Failed to ...")`. Errors are
  always JSON `{ error: string }`, never an empty body (the client calls `res.json()`).
- **prepare** returns `{ unsignedXdr, ... }` (or `{ needsRestore: true, restoreXdr }` when
  Soroban state expired); **submit** takes the signed XDR, runs txguard, submits, then writes
  the cache row.
- **Server-only modules** import `"server-only"`. Never import `lib/supabase.ts`,
  `lib/session.ts` or anything holding secrets from a client component.
- **Env vars:** add to the `lib/env.ts` schema *and* `.env.example`. `NEXT_PUBLIC_*` is visible
  to the browser, so never put a secret in one. `SESSION_COOKIE_SECRET` must not be the
  placeholder in production.
- **Imports** use the `@/` alias for the repo root.
- **Comments** explain *why* (the invariant, the failure it prevents), not what. Match the
  density already in `lib/`.
- **Tests:** pure logic and route handlers are tested with Vitest in `test/`, named
  `<module>.test.ts` or `<flow>.route.test.ts`. Use `test/helpers/supabaseMock.ts` for the DB;
  nothing may hit the network. New security-relevant behaviour (txguard, session, sep10) needs
  a test that proves the *rejection* path, not just the happy path.
- **Database:** every statement must be safe to run twice (`if not exists`, `where` guards);
  there is no applied-migrations table.
- **Commits:** short imperative subject saying what changed for the user or why (see
  `git log`). Do not commit unrelated dirty files; check `git status` first.

## UI and UX work

Do not edit components or CSS for a design change straight away. Present the proposal on a
separate preview page first (a published Artifact works well) with an ID per proposal
(D1, D2, ...), wait for explicit approval per ID, then implement only the approved ones. Bug
fixes and behaviour changes that do not alter the design are exempt.

## Known traps

- Blend ledger entries expire; a borrow simulation can fail with expired footprints. That is
  the `RestoreRequiredError` → restore-transaction path, not a bug to "fix" by retrying.
- Blend tracks one debt position per *wallet*; loan rows are per advance, so mapping debt
  back onto rows is an approximation (`staleLoanIds` reconciles).
- Testnet RPC returns occasional 502s. Flows are resumable, so do not add hidden retries that
  could double-submit a transaction.
- Contract ids live in `.env.example` and the README's "Deployed artifacts" table; keep them
  consistent, and do not treat the test ids in `vitest.config.ts` as real deployments.
- `docs/` can lag behind the code. Verify against the source before relying on a status claim
  such as "not yet wired in".

## Where to look next

| You are... | Read |
|---|---|
| Changing money movement or auth | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [lib/txguard.ts](lib/txguard.ts), [lib/sep10.ts](lib/sep10.ts) |
| Adding or calling an endpoint | [docs/API.md](docs/API.md) |
| Touching tables | [docs/DATA-MODEL.md](docs/DATA-MODEL.md), [supabase/migrations/README.md](supabase/migrations/README.md) |
| Touching the contract | [docs/CONTRACT-ADVANCE-REGISTRY.md](docs/CONTRACT-ADVANCE-REGISTRY.md), [docs/ARCHITECTURE-advance-registry.md](docs/ARCHITECTURE-advance-registry.md) |
| Wondering why Blend / no term / no anchor | [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md) |
| Deciding scope | [docs/PRD.md](docs/PRD.md), [docs/BUSINESS-MODEL.md](docs/BUSINESS-MODEL.md) |
