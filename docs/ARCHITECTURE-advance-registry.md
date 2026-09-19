# Architecture — wiring the advance registry into the cash advance flow

Status: design, not implemented. The contract in `contracts/advance-registry/` exists and is
tested; nothing in the app calls it yet. This document decides how it gets called, what
happens when it is not, and what it is allowed to be believed about.

Scope is deliberately narrow: the integration. It does not revisit the borrow flow, the
anchor, or the pool.

## 1. What problem this is actually solving

Today the borrower's side of an advance — how much fiat they were paid, against how much
debt, on what terms — exists only in a Postgres row the operator controls. The registry is
the borrower's independent, self-signed copy of that statement.

That makes its role precise, and narrower than it first looks:

> **The registry is authoritative about consent, not about money.**

It says "this account signed a statement that it took this advance on these terms." It says
nothing reliable about whether the debt is still outstanding, whether the lira arrived, or
what is owed now. Those questions already have better answers.

### Authority order

Per question, the first source that can answer wins. This is the rule the code must follow;
everything else in this document is downstream of it.

| Question | Authority | Why not the registry |
|---|---|---|
| Is there debt, and how much? | **Blend pool** | The registry records the opening amount, never the accruing balance |
| Did the TRY move? | **Anchor** (SEP-6 status) | The registry is written before settlement completes |
| What did the borrower agree to? | **Advance registry** | This is the one thing Postgres cannot prove |
| Everything else, fast | **Supabase** (cache) | Unchanged from today |

**Hard rule: no code path reads the registry to compute a balance, a health factor, or a
repayment amount.** It is read for display and for dispute evidence. `lib/blend.ts` stays
the only source of position data. A reviewer should be able to grep for registry reads and
find them only in presentation routes.

## 2. Where `open` goes in the flow

Current flow, from the README, with the new step in place:

```
1. reserve      POST /api/loans/borrow/start
2. trustline    POST /api/loans/trustline/{prepare,submit}      [skipped if present]
3. collateral   POST /api/loans/collateral/{prepare,submit}     <- wallet signs
4. borrow       POST /api/loans/borrow/{prepare,submit}         <- wallet signs
5. payout       POST /api/loans/borrow/payout/{prepare,submit}  <- wallet signs
6. record       POST /api/loans/borrow/record/{prepare,submit}  <- wallet signs   * NEW, OPTIONAL
7. settle       anchor pays the IBAN; GET /api/withdraw/[id]/status flips to `active`
```

### The decision

**`open` is step 6: after the payout lands, in the same session, and it is not a gate.**

Step 5 is the moment the borrower's obligation becomes irreversible — the debt exists in the
pool and the USDC has left for the anchor. That is what they are attesting to, so that is
when the attestation is meaningful. Before it, there is nothing settled to sign.

"Not a gate" is the load-bearing half. An advance is complete at step 5. Step 6 is offered,
can be declined, and can be done later from the loan detail view. Nothing downstream —
resume, status, repayment, collateral release — checks for it.

### Options rejected, and why

- **Bundle `open` into the payout transaction (no extra signature).** *Impossible.* Stellar
  permits [only one `InvokeHostFunctionOp` per transaction](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction#xdr-usage),
  and the payout is a classic `payment`. They cannot share a transaction. Separately, this
  would have required relaxing `singleOperation()` in `lib/txguard.ts`, which is load-bearing
  security, to buy a UX saving — a bad trade even if the protocol allowed it.
- **Record between borrow and payout (step 4.5).** Writes an immutable claim that an advance
  was paid out before the payout has been attempted. If step 5 then fails, the permanent
  record is wrong on the borrower's behalf. Immutable records should only be written about
  things that already happened.
- **Record after settlement (step 7.5), when the TRY has actually arrived.** The most
  *accurate* moment, and the one that would fix the open gap in §7. Rejected on completion
  rate: settlement is asynchronous and the borrower has closed the tab. A registry that only
  a minority of advances reach is not an independent record, it is anecdote. Kept as the
  fallback path rather than the primary one.
- **Make it mandatory.** Turns a declined signature into a stuck advance and adds a sixth
  failure mode to a flow whose central design goal is that it can always be resumed.

## 3. Deriving `id` and `payout_ref`

Both are server-derived, deterministic, and computed in exactly one place
(`lib/registry.ts`). Never accepted from the client, never recomputed elsewhere.

### `id` — content-addressed from the borrow intent

```
id = sha256("stellend-advance-v1|" + withdrawal.id)          // 32 bytes
```

`withdrawal.id` is the borrow intent's primary key: a server-generated UUIDv4, unique per
advance, unguessable, and already the identifier every other step keys off
(`loadWithdrawalIntent`). Domain-separated so the same preimage can never collide with a
future hash of ours.

**Determinism buys idempotency.** A retried step 6 rebuilds the same `id`, the contract
returns `AlreadyExists`, and the submit route treats that as success — the record we wanted
is on chain. Without this, a flaky network turns into a permanent error the borrower cannot
clear.

### `payout_ref` — the fiat leg, without the personal data

```
payout_ref = sha256("stellend-payout-v1|" + withdrawal.anchor_ref + "|" + normalizeIban(iban))
```

The IBAN never goes on a public ledger. The borrower keeps the originals and can reveal them
to prove which payout a record covers. `normalizeIban` from `lib/iban.ts` is already the
canonical form written to the row, so the preimage is reproducible — **its normalisation
behaviour is now a compatibility surface and must not change**, or old records stop
verifying. Worth a comment at that function.

Residual risk, accepted: the preimage is low-entropy, so someone who already knows
`anchor_ref` could confirm a guessed IBAN. `anchor_ref` is not public, and anyone holding it
is the borrower or the operator, who both know the IBAN anyway.

### `due_at` — say the same thing on chain as in the UI

The product's stance is that there is no term (README, "Known limitations"), and the contract
agrees — it enforces bounds on `due_at` and then explicitly does not act on it. So pass
exactly the value already written to `loans.due_at` by `dueDateFrom()`, and make the signing
prompt say what it is: *a target close date you are committing to, not a deadline anything
enforces.*

**Invariant: on-chain `due_at` and `loans.due_at` are the same instant.** If they ever
diverge, the borrower signed something different from what the app shows, which is the exact
failure this feature exists to prevent.

## 4. Guarding the signed transaction

`lib/txguard.ts` gains `assertRegistryOpen` and `assertRegistryMarkRepaid`. They follow the
existing shape — decode, check, refuse — with one difference worth calling out:

**Every argument is server-derived, so every check is equality, not a bound.** The pool
guards have to use `minAmount`/`maxAmount` because the client legitimately picks the amount.
Here it does not pick anything. `assertRegistryOpen` asserts:

- exactly one operation, sourced by the session wallet (reuses `singleOperation`)
- `invokeContract` against `NEXT_PUBLIC_ADVANCE_REGISTRY_ID`, function `open`
- `borrower == session.publicKey`
- `id == advanceId(intent)`, `payout_ref == payoutRef(intent)`
- `usdc_amount == toFixedAmount(intent.usdc_amount)`, `try_amount` == the intent's TRY in
  minor units, `due_at == loans.due_at`

A mismatch means the client tried to record something other than its own advance. Refuse and
`audit(..., "rejected", ...)`, matching `borrow/submit` and `payout/submit`.

Note the unit mismatch the contract's field docs set up: `usdc_amount` is 7-decimal stroops,
`try_amount` is 2-decimal minor units. Two different scales in adjacent arguments is a
latent bug; put both conversions in `lib/registry.ts` next to each other with the comment
that explains why they differ, and never inline them at a call site.

## 5. `mark_repaid` — who calls it

The contract requires the *stored borrower's* auth, so only the wallet can close a record.
The server cannot, and — per standing project rule — must not grow a keypair to do it.

So it mirrors step 6. When `repay/submit` computes `fullyRepaid === true` from the pool and
the loan has a registry record, the UI offers one more signature:
`POST /api/loans/[id]/registry/close/{prepare,submit}`. Optional, declinable, retriable
later.

A borrower who never calls it leaves a stale `Open` record. The contract already says this
costs them their own good standing and nothing else, and the authority order in §1 means no
part of the app is misled by it. That is the correct trade against the alternative, which is
a server key.

## 6. What changes, concretely

### New

- **`lib/registry.ts`** — the whole contract surface in one module: `advanceId()`,
  `payoutRef()`, the unit conversions, `buildOpenTransaction()`,
  `buildMarkRepaidTransaction()`, `getAdvance()`, `listAdvances()`, and `registryEnabled()`.
- **Routes** — `app/api/loans/borrow/record/{prepare,submit}`,
  `app/api/loans/[id]/registry/close/{prepare,submit}`. Same prepare/submit shape as every
  other on-chain action; no new pattern.
- **`lib/txguard.ts`** — the two asserts from §4.

### Refactor, minimally

`buildSubmitTransaction` in `lib/blend.ts` is private and pool-shaped, but its body is ~40
lines of simulate / `isSimulationRestore` / `assembleTransaction` handling that the registry
needs identically. Duplicating it would duplicate the `RestoreRequiredError` path, which §8
shows the registry genuinely hits.

Extract `prepareSorobanTransaction(account, operation)` and let `buildSubmitTransaction`
become a three-line caller. This is a move of existing code to its second caller, not a
speculative abstraction — the restore semantics stay in one place, which is the point.

### Schema

```sql
alter table withdrawals add column if not exists advance_id  text;  -- hex, the derived id
alter table withdrawals add column if not exists registry_tx text;  -- open() tx hash
alter table loans       add column if not exists registry_closed_tx text;
```

Cache only, consistent with the rest of the schema: `registry_tx` being null means "we have
not seen it recorded", never "it is not recorded". The chain settles that question.

### Deliberately unchanged

**`borrowStage` gains no stage, and `resume` gains no gate.** Adding a `record` stage would
make every declined signature into a permanently unfinished advance blocking the next one —
the resume logic selects on `status in ('pending','processing')`. Instead `resume` and
`/api/loans/mine` expose `registryRecorded: boolean`, and the UI offers an action. This is
the single property that keeps the feature additive; a reviewer should check it first.

## 7. Failure matrix

| What happens | Result | Handling |
|---|---|---|
| Borrower declines step 6 | Advance is complete, no on-chain record | Offer again from loan detail. No gate. |
| Step 6 submitted twice | `AlreadyExists` | Treated as success — the derived `id` makes it idempotent |
| `open` fails (RPC, fees, simulation) | Advance still complete | Surface, offer retry, do not touch `withdrawals.status` |
| Registry not deployed / env unset | Feature absent | `registryEnabled()` false; routes 404, UI hides the action |
| Anchor later fails or refunds after step 6 | **Open gap.** An on-chain record of an advance whose TRY never arrived | See below |
| Borrower never calls `mark_repaid` | Stale `Open` record | Accepted, per §5 and the contract's own docs |
| Record archived by TTL | `get`/`mark_repaid` fail | Restore, §8 |

**The anchor-failure gap is real and unfixed.** Recording at step 6 means a payout that
later errors or is refunded leaves a permanent claim that the borrower received lira they
did not. The contract has no `void`. Two honest ways out, neither taken now: record at
settlement instead (§2, rejected on completion rate), or add a `void` entry point
authorised by the borrower. It is listed here rather than papered over because the frequency
is unknown against a mock anchor and should be measured in the Phase 2 pilot before a
contract change is designed around a guess.

## 8. State archival — the contract's read-path TTL does not work

The contract extends TTL on `get` and `list`. That extension only commits when the call runs
as a **submitted transaction**; the app reads through `simulateTransaction`, which does not
change ledger state. So read-path bumps never land, and a record untouched for the ~60-day
window archives.

This is not a crisis — it is recoverable, and the recovery path already exists. A
`mark_repaid` against an archived entry surfaces as `RestoreRequiredError` from the shared
simulate helper, which the wallet resolves through the existing
`POST /api/loans/restore/submit` + `assertRestoreFootprint` flow, exactly as the pool's
archived entries are handled today. Reuse it; write no new restore code.

Two follow-ups, in order of value:

1. **Fix the contract's doc comment.** "Reading extends its TTL, so an advance anyone is
   still watching stays alive" is not true as written and will mislead the next reader.
2. Consider dropping `extend_ttl` from `get`/`list` entirely, since it costs instructions in
   simulation and buys nothing. Keep it on the write paths, where it does work.

## 9. One contract change worth making before this is committed

`DataKey::Advance(BytesN<32>)` is a **global** namespace: any account can call `open` with
any id. Someone who learns a withdrawal id can squat it under their own address, and the
real borrower's `open` then fails with `AlreadyExists` forever, with no way to recover the id.

The ids are unguessable UUIDv4-derived hashes, so exposure is small — but the fix is one
line and the contract is not committed yet, which is the cheapest this will ever be:

```rust
Advance(Address, BytesN<32>),   // namespaced per borrower
```

Squatting then becomes impossible by construction rather than by entropy, and `list` already
keys by borrower so nothing else moves. `get` and `is_overdue` grow a `borrower` argument;
callers have it. Tests will need updating.

## 10. Deployment

- Env: `NEXT_PUBLIC_ADVANCE_REGISTRY_ID`, optional in `lib/env.ts`'s schema, matching the
  existing lazy-parse pattern. Unset = feature off, not a crash.
- Add a `scripts/deploy-registry.sh` alongside the existing scripts; record the testnet
  contract id in `.env.example` the way the Blend pool and USDC ids already are.
- CI: the `.github` workflow runs `cargo test` for `contracts/` — the contract has a full
  test suite and snapshots, and they should gate merges like the TypeScript tests do.
- README: the flow diagram gains step 6, and "Known limitations" gains the anchor-failure gap
  from §7. The README's honesty about what does not work is the project's best feature; this
  should not be the first thing that gets quietly left out of it.

## 11. Implementation order

Each step leaves the tree working and reviewable on its own.

1. Contract: apply §9, update tests, fix the §8 doc comment. Cheapest now.
2. Deploy to testnet; add env, `registryEnabled()`, `.env.example`, deploy script, CI job.
3. Extract `prepareSorobanTransaction` from `lib/blend.ts`. Pure refactor, no behaviour
   change, existing tests must pass untouched.
4. `lib/registry.ts` — derivations and builders. Unit-test `advanceId`/`payoutRef` against
   fixed vectors; they are a compatibility surface forever.
5. Guards in `lib/txguard.ts`, tested against a tampered XDR for each field, matching how the
   pool guards are tested.
6. Schema columns; `registryRecorded` on `resume` and `/loans/mine`.
7. Step 6 routes + the `BorrowFlow` step. Confirm resume is untouched by a declined signature.
8. `mark_repaid` routes + the offer in `RepayFlow`.
9. Docs: README flow and limitations.
