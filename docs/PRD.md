# Stellend — Product Requirements Document

Status: draft for review · Cycle: Phase 0 → Phase 1 · Owner: product
Companion documents: [README.md](../README.md) (what exists), [BUSINESS-MODEL.md](BUSINESS-MODEL.md) (who it is for, how it earns)

---

## 1. The decision this document makes

Stellend today is a complete, security-hardened testnet proof of concept. Both flows work
end to end: a borrower locks collateral, draws USDC from a Blend v2 pool and receives lira;
a lender sends lira and ends up supplying the same pool. Sessions are bound to the anchor's
SEP-10 token, every signed transaction is decoded and checked before submission, and
interrupted advances resume from the step they stopped at.

So the question is not "what is broken". It is **what to build next, given that the one
dependency everything rests on does not exist yet.**

[BUSINESS-MODEL.md §5](BUSINESS-MODEL.md) is blunt about this: there is no production TRY
anchor on Stellar, and the regulatory position means this realistically ships *inside* a
licensed partner rather than as an independent product. Every revenue model assumes that
partner. The mock anchor stays until that partner exists.

That has a direct consequence for scope, and it is the central call in this PRD:

> **The next cycle is not about adding product surface. It is about making the Phase 1
> partner conversation answerable.** A Turkish exchange or payment institution will ask
> four questions. Today we can answer one of them from the code.

| What a partner will ask | Can we answer it from the product today? |
|---|---|
| "How does this make money, and what is our share?" | No — revenue is a proposal in a markdown file. Zero fee logic exists. |
| "What did the borrower actually agree to, and can they dispute it?" | Partially — the record is a row in a Postgres table we control. |
| "Where does our KYC and our licence plug in?" | No — no documented integration seam. |
| "Is it non-custodial, really?" | **Yes** — and this is the strongest thing we have. |

This cycle closes the first three. It explicitly does *not* try to validate demand, because
demand cannot be validated on testnet against a mock anchor with zero users. Saying so now
is cheaper than discovering it after a quarter of building.

---

## 2. Goals and non-goals

### Goals

- **G1.** Make revenue model A (origination fee) real, configurable and disclosed — so the
  take rate becomes a number a partner can negotiate rather than a paragraph.
- **G2.** Give the borrower an independent, tamper-evident copy of what they agreed to,
  held under their own key rather than in our database.
- **G3.** Make the borrower's understanding of open-ended debt and liquidation risk an
  explicit, recorded consent step, not something inferred from a dashboard.
- **G4.** Document the seam where a licensed partner's anchor, KYC and compliance attach —
  precisely enough that a partner's engineer can scope the work.
- **G5.** Make the whole thing reproducible by a stranger in under fifteen minutes, because
  grant reviewers and partner engineers will not debug our setup.

### Non-goals for this cycle

Each of these is deliberate. Reopening one should require a reason, not a preference.

- **Mainnet.** Blocked on a real anchor and a resolved regulatory position. Not a build task.
- **A real TRY anchor, and SEP-12 KYC.** Out of scope until a licensed partner exists.
  We build the seam, not the integration.
- **Running our own Blend pool.** [BUSINESS-MODEL §3 model C](BUSINESS-MODEL.md) — that is a
  different company, and it needs backstop capital and liquidation coverage.
- **A liquidation bot.** A Phase 2 finding, not a Phase 0 assumption. We disclose the risk;
  we do not take it on.
- **Unsecured lending, custody, mobile apps, additional collateral assets, multi-anchor.**
- **A server-held keypair, for any reason including fee collection.** Non-custody is the
  single advantage we hold over a licensed exchange. See NFR-3.

---

## 3. Users

Restated from [BUSINESS-MODEL §1](BUSINESS-MODEL.md) because requirements below trace to these.

**Borrower — "I have crypto, I need lira, I don't want to sell."**
25–45, urban, holds $2k–$50k of crypto, wants 5,000–50,000 TRY, expects to close within a
month or two from income rather than from trading. Their real comparison is not our fee — it
is the exchange fee *plus* the capital gain they avoid realising, which on an appreciated
position is often several percent.

**Lender — "I have lira, and lira loses value."**
25–55, 5,000–250,000 TRY of savings, moves in one or two chunks, cares about "can I get it
back" far more than about the last two points of yield.

**Partner (new in this cycle, and the actual buyer for Phase 1).**
A licensed Turkish exchange or payment institution. Has the licence, the KYC stack and the
users. Does not have a ramp-to-DeFi flow. Evaluates on: revenue share, compliance
defensibility, integration cost, and whether custody risk lands on them. This cycle's
features are mostly aimed at this user, which is a change from every previous cycle.

---

## 4. Where we are

Shipped and working (testnet):

- Full borrow flow — reserve intent → trustline → collateral → borrow → payout → settle,
  with `GET /api/loans/borrow/resume` recovering any interruption, including the dangerous
  state where USDC is borrowed but has not reached the anchor.
- Full lender flow — quote → SEP-6 deposit → bank transfer → auto-supply to the pool, plus
  liquidity withdrawal.
- Repay, collateral release, markets, profile, transaction history, sandbox bank.
- Security: SEP-10-derived session identity, per-transaction decode-and-verify
  (`lib/txguard.ts`), server-side amounts, AES-256-GCM session cookie, origin checks and
  rate limits on every route, audit trail.
- Live position risk: what is owed now, today's interest, distance to liquidation — replacing
  the term-loan fiction.
- CI running typecheck, lint, tests and build.

Built since this PRD was drafted, and not yet reachable by a user:

- **The advance registry back end.** The contract is deployed to testnet, `lib/registry.ts`
  derives the deterministic advance id and the hashed payout reference, four prepare/submit
  routes exist, `lib/txguard.ts` guards `open` and `mark_repaid`, and `resume` reports
  `registryRecorded` without gating the advance on it. What is missing is the entire product
  surface: no component calls any of those routes, so no borrower can sign a record.
  See [EPICS-AND-STORIES.md](EPICS-AND-STORIES.md) — Epic 2 is now the UI half only.

- **A red build.** `npm run typecheck` and `npm test` both fail on the new work — a duplicate
  `USDC` binding stops `test/txguard.test.ts` transforming at all, so the new registry guard
  tests have never executed, and BigInt literals exceed the `ES2017` target. Until this is
  fixed, "tested" is not a claim this repository can make.

Not built at all: any revenue mechanism, any explicit consent gate, any partner-facing
integration documentation.

---

## 5. Scope — epics in priority order

### Epic 1 — Origination fee, end to end · **P0**

*Answers: "how does this make money, and what is our share?"*

The recommendation in [BUSINESS-MODEL §3](BUSINESS-MODEL.md) is model A, and it is described
there as low build cost — "one extra transfer in the borrow flow". Until it exists, every
partner conversation about revenue is hypothetical. Building it also forces the disclosure
question, which is the part that is actually hard.

| ID | Requirement |
|---|---|
| FR-1.1 | The fee rate is configuration, expressed in basis points, with a documented default of 75 bps (0.75%) and a hard ceiling of 300 bps enforced at startup. Changing the take rate must not require a code change — a partner will want to negotiate it. |
| FR-1.2 | The fee is quoted **before** the borrower signs anything. `POST /api/loans/borrow/start` returns the advance amount, the fee in both USDC and TRY, and the net TRY the borrower will receive, as three separate fields. |
| FR-1.3 | The borrow UI shows the fee as a distinct line item next to the amount received. It is never netted silently into the exchange rate — that is model B, and model B needs an anchor relationship we do not have. |
| FR-1.4 | The fee is collected as a USDC payment to a configured collection **address** during the payout step, in the same signed transaction as the anchor payout where the protocol allows it, so the borrower authorises one operation rather than two. |
| FR-1.5 | `lib/txguard.ts` verifies the fee operation on the submitted transaction: correct destination, correct asset, and an amount matching the server's reserved intent — not the client's claim. A client that reduces its own fee must be rejected. |
| FR-1.6 | The fee is recorded against the advance and surfaced in transaction history, so a borrower can always reconstruct what they paid. |
| FR-1.7 | A fee rate of 0 bps is valid and disables collection entirely, with no fee operation and no fee line in the UI. This is the demo default. |

**Open question this epic does not resolve, and must not pretend to:** whether 75 bps is
enough or whether borrowers accept 150. That needs real borrowers. What we get here is the
ability to *change the number and quote it honestly* — which is what the partner
conversation actually needs.

---

### Epic 2 — Ship the advance registry · **P0**

*Answers: "what did the borrower agree to, and can they dispute it?"*

The contract is written and tested. The gap is that the borrower's side of the agreement
still lives only in a table we control, exactly as the contract's own module docs say. A
compliance reviewer at a licensed partner will notice this immediately; so will a borrower
in a dispute. Finishing it converts our best asset — non-custody — from a property of the
funds into a property of the record.

| ID | Requirement |
|---|---|
| FR-2.1 | Commit the contract, and add its build and `cargo test` to CI as a job separate from the Node checks. A contract with tests that CI never runs is a contract that will silently break. |
| FR-2.2 | Deploy to Stellar testnet and record the contract id in `.env.example` with the other testnet addresses. |
| FR-2.3 | After a successful payout, the borrower is offered a record step that invokes `open` under their own authorisation, with the id derived deterministically from the borrow intent so a retry is idempotent rather than duplicating the record. |
| FR-2.4 | **The record step never blocks the fiat.** A failed, declined or abandoned record leaves a completed, correct advance. It is retryable later from the loan view, and `resume` reports it as an outstanding optional step, never as a broken advance. |
| FR-2.5 | `payout_ref` is a hash of the anchor's withdrawal id and destination. No IBAN, no name, no account number reaches the ledger — the borrower holding the originals can still prove which payout a record covers. |
| FR-2.6 | The loan view shows whether a record exists, links to it on an explorer, and states in plain language what it does and does not mean: it proves what was agreed; it is not the source of truth for whether the debt is outstanding — the pool is. |
| FR-2.7 | Repayment offers `mark_repaid`, under the same never-blocking rule. A stale `Open` record costs the borrower their own standing and nothing else. |

**Alignment question flagged for the architect.** The contract stores `due_at` and validates
it as a commitment, while the most recent product change deliberately stopped presenting a
due date as something enforced, because Blend is perpetual and nothing closes a position on
a date. These two are not yet telling the same story. Resolve before FR-2.3: either the UI
presents `due_at` as an explicitly non-binding target the borrower chooses to sign, or the
field comes out of the record. Shipping the contradiction is worse than either option.

---

### Epic 3 — Informed consent at borrow time · **P1**

*Answers the compliance question a partner's risk team asks first.*

[BUSINESS-MODEL §5](BUSINESS-MODEL.md) lists "borrowers must accept an open-ended debt with
liquidation risk" as the third most likely thing to kill the idea, and adds: "this has to be
understood before signing, not discovered after." The live position view added last cycle
shows the risk *after* borrowing. Nothing gates it before.

| ID | Requirement |
|---|---|
| FR-3.1 | Before the first signature of an advance, the borrower is shown four facts in plain Turkish and plain English: there is no term and interest accrues from the first ledger; the collateral can be sold if its price falls; no liquidator is guaranteed to appear; the fee and the anchor's rate. |
| FR-3.2 | Proceeding requires an explicit acknowledgement, not a scroll or a hover. |
| FR-3.3 | The acknowledgement is recorded in the audit trail with the disclosure version and a timestamp, so we can show *which* wording a given borrower saw. |
| FR-3.4 | Disclosure text is versioned content, editable without a code change — a partner's compliance function will rewrite it, and that must not be a deploy. |
| FR-3.5 | Shown once per advance, not once per session. Each advance is a separate agreement. |

---

### Epic 4 — The partner integration seam · **P1** · documentation

*Answers: "where does our licence plug in?"*

No code. A document, `docs/PARTNER-INTEGRATION.md`, precise enough that a partner's engineer
can estimate the work in an afternoon.

| ID | Requirement |
|---|---|
| FR-4.1 | Name every point where the mock anchor is touched, and state exactly which SEPs a replacement must implement (SEP-10, SEP-6, SEP-38) and which we currently assume but do not verify. |
| FR-4.2 | Specify where SEP-12 KYC attaches — which flows gate on it, what a rejection does to an in-progress advance, and what we would need to store versus never store. Specification only; no implementation this cycle. |
| FR-4.3 | State plainly what the partner takes on and what they do not: no key custody at any point, the pool is Blend's and not ours, liquidation depends on third-party liquidators who may not appear for our collateral. Understating this loses the second meeting rather than the first. |
| FR-4.4 | Show where the revenue split attaches, referencing the Epic 1 configuration. |
| FR-4.5 | List the open regulatory questions we cannot answer ourselves — CMB licensing, MASAK obligations — as questions for them, not as claims from us. |

---

### Epic 5 — A demo a stranger can run · **P2**

*Grant reviewers and partner engineers do not debug our setup. They close the tab.*

| ID | Requirement |
|---|---|
| FR-5.1 | A documented path from clone to a completed borrow and a completed deposit, against testnet and the mock anchor, in under fifteen minutes. |
| FR-5.2 | Funding a fresh test wallet, and the sandbox bank transfer, are part of that path rather than tribal knowledge. |
| FR-5.3 | Missing or misconfigured environment values fail at startup with a message naming the variable and what a valid value looks like — not at the fourth step of a flow. |
| FR-5.4 | The testnet and mock-anchor status is visible in the running application, not only in the README. |

---

## 6. Non-functional requirements

- **NFR-1 — The chain stays authoritative.** Supabase remains a cache. Where the two
  disagree the code prefers the chain. New state added by Epics 1 and 2 must not become a
  second source of truth for debt.
- **NFR-2 — Every new signed operation is guarded.** Anything added to a transaction passes
  through `lib/txguard.ts` with an amount bound in whichever direction the step can be gamed.
  An unguarded operation is a defect regardless of test coverage.
- **NFR-3 — No server-held keypair.** Including for fee collection: the collection target is
  a public address the operator controls elsewhere. Non-custody is the only durable advantage
  over a licensed exchange, and a server signer forfeits it permanently.
- **NFR-4 — Every new flow is resumable.** Any step that can be interrupted is reported by
  `resume` and recoverable from the UI.
- **NFR-5 — No personal data on chain.** Hashes and amounts only.
- **NFR-6 — Bilingual where it is legally material.** Disclosure and fee text in Turkish and
  English. The rest of the UI may stay English this cycle.
- **NFR-7 — CI stays green across both toolchains**, Node and Rust, on every branch.

---

## 7. How we know it worked

This cycle's outcome is a conversation, not a metric — so the criteria are evidential.

**Ship criteria**

- A borrow with a non-zero fee completes on testnet; the fee arrives at the collection
  address; a tampered fee amount is rejected by `txguard` and there is a test proving it.
- An advance is recorded on chain under the borrower's key, is visible on an explorer, and a
  deliberately failed record leaves a correct, complete advance.
- A borrower cannot reach the first signature without an acknowledgement recorded in the
  audit trail.
- `docs/PARTNER-INTEGRATION.md` reviewed by someone outside the project who can then state
  what a partner must build.
- A person who has never seen the repository completes both flows from the README alone.

**Cycle outcome**

- Three or more partner conversations in which the revenue model is discussed as a number.
- Zero conversations lost on "but you hold the keys" or "but the record is just your
  database" — if either comes up, Epics 1 and 2 did not do their job.

**Explicitly not measured:** users, volume, TVL, repayment rate. There is no real anchor.
Any number we report from testnet is theatre, and a partner will know it.

---

## 8. Open decisions

Listed because they are unresolved, not because they are rhetorical. Each has an owner
outside this document.

1. ~~**`due_at`: commitment or fiction?**~~ **Closed.** Resolved in
   [ARCHITECTURE-advance-registry.md](ARCHITECTURE-advance-registry.md): it is a target close
   date the borrower commits to, explicitly not a deadline anything enforces, and the signing
   prompt says so. FR-2.3 is unblocked.
2. **Is the record step worth the friction?** It adds a fifth signature to an already long
   flow. FR-2.4 makes it optional and non-blocking, which is the cheapest way to find out —
   but if adoption is near zero, folding it into the payout transaction or dropping it are
   both live options.
3. **Default fee rate for the demo.** FR-1.7 defaults to zero so the demo shows the
   mechanism without asserting a price we have not tested. If a partner conversation needs a
   number in front of it, 75 bps per the unit economics.
4. **Fee in USDC or in TRY?** This PRD assumes USDC, because that is where the borrow lands
   and it avoids a second anchor round trip. Charging in TRY reads better to a Turkish
   borrower and should be revisited once an anchor is real.
5. **Turkish across the whole UI, or only where it is legally material?** NFR-6 takes the
   narrow option this cycle. A partner pilot will not accept it.

---

## 9. What we are betting on, and what would falsify it

The bet: **our advantage is non-custody and composability, not price or convenience**, and
that advantage is legible enough to a licensed partner that they would rather integrate us
than rebuild us.

What would falsify it, in the order we would find out:

1. Partners say the compliance burden of a non-custodial flow exceeds the benefit — they
   would rather custody and be done. *This kills the thesis, not the cycle.*
2. Partners want the flow but not us — the code is four months of work and no moat. Epic 2
   is the beginning of an answer; it is not yet a sufficient one.
3. No partner engages at all, and the regulatory position hardens. Phase 3 — our own pool,
   serving a non-Turkish market — becomes the only path, and this cycle's work still holds
   because none of it depends on the TRY leg.
