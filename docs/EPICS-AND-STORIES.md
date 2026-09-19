# Stellend — epics and stories

Companion to [PRD.md](PRD.md). The PRD decides *what* and *why*; this decides *in what order*
and *done means what*. Every story traces to a PRD requirement, or says why it has none.

Status as of 2026-09-20. Sizes are relative (S/M/L), not estimates.

---

## What changed since the PRD was written

The PRD's picture of "where we are" is out of date in one direction and one direction only:
**Epic 2 was mostly built while the PRD was being reviewed.** Verified in the working tree:

| PRD requirement | State |
|---|---|
| FR-2.1 contract committed, `cargo test` in CI | Contract has `count` and `list`; a `contracts` job exists in CI |
| FR-2.2 deployed, id in `.env.example` | `NEXT_PUBLIC_ADVANCE_REGISTRY_ID` is a real testnet id |
| FR-2.3 deterministic id | `advanceId()` = sha256 over a versioned domain prefix, in `lib/registry.ts` |
| FR-2.4 never blocks the fiat | `resume` exposes `registryRecorded` and explicitly does not gate `borrowStage` |
| FR-2.5 hashed `payout_ref` | `payoutRef()` hashes anchor ref + normalised IBAN |
| FR-2.6 / FR-2.7 record + close | Four routes exist: `borrow/record/{prepare,submit}`, `loans/[id]/registry/close/{prepare,submit}` |
| NFR-2 guarded | `lib/txguard.ts` gained `open` and `mark_repaid` guards, ~118 lines |

Two things that picture does not include, and both are why E0 and E2 below exist.

**The build is red.** `npm run typecheck` and `npm test` both fail on the new work:

- `test/txguard.test.ts` declares `const USDC` twice (lines 18 and 254). esbuild refuses to
  transform the file, so the whole suite is skipped — **the 194 lines of new registry guard
  tests have never run once.** The guards may well be correct; nothing has demonstrated it.
- `tsconfig.json` targets `ES2017`, and the new tests use BigInt literals (`1_800_000_000n`).
  Both `test/registry.test.ts` and `test/txguard.test.ts` fail typecheck.

**No borrower can reach the feature.** `BorrowFlow.tsx` changed by seven lines and contains
no record step; nothing in `components/` calls any of the four registry routes. The backend
is complete and the product surface is absent. That is the most expensive state a feature can
sit in — paid for, not earning.

One PRD open decision is now closed: `due_at` is resolved as "a target close date you are
committing to, not a deadline anything enforces"
([ARCHITECTURE-advance-registry.md](ARCHITECTURE-advance-registry.md)). FR-2.3 is unblocked.

---

## The sequencing call

The PRD ordered work for a partner conversation: fee first, registry second. That order is
wrong now, for two reasons.

1. **Half-built beats unbuilt only if it gets finished.** The registry is four routes, a
   contract, a deploy and a guard away from done, with no way to use it. Starting the fee
   epic on top of that leaves two incomplete features instead of one.
2. **[PITCH.md](PITCH.md) revealed a constraint the PRD did not model** — a Stellar Pro
   Hackathon submission, Genesis Track. A judged demo rewards a finished differentiator and
   punishes a visible gap. It does not reward a configurable take rate.

So: **finish the registry, then make the demo bulletproof, then the fee.** The fee epic is
still the right answer for Phase 1; it is not the right answer for this week.

```
E0 unblock ──▶ E2 finish registry ──▶ E5 demo path ──▶ E3 consent ──▶ E1 fee ──▶ E4 partner doc
   (hours)         (days)                (1 day)         (days)        (days)      (writing)
   ▲
   └── blocks everything: CI is red, so nothing below can be trusted as "done"
```

**This ordering assumes the hackathon deadline is near.** If it is not, swap E1 forward of
E3 and E5 and run the PRD's original order — that is the one input I do not have.

---

## E0 — Unblock the build · P0 · blocks everything

No story below can be called done while `npm test` skips a suite and `npm run typecheck`
fails. These are mechanical, but leaving them means the registry guards ship unverified.

### S0.1 — Fix the duplicate `USDC` binding in the txguard tests · S

**As a** developer, **I want** the txguard suite to compile, **so that** the registry guards
are actually tested rather than merely written.

- [ ] `test/txguard.test.ts` has one binding per name; the second `USDC` (and any other
      shadowed constant in the new block) is renamed to something scoped to its describe.
- [ ] `npm test` reports 15 suites passing, 0 failed.
- [ ] The new registry guard tests appear in the run output by name.

*Traces to: NFR-2, NFR-7.*

### S0.2 — Raise the TypeScript target so BigInt literals compile · S

**As a** developer, **I want** `npm run typecheck` to pass, **so that** CI's typecheck step
means something.

- [ ] `tsconfig.json` targets `ES2020` or later.
- [ ] `npm run typecheck` exits clean.
- [ ] `npm run build` still succeeds — confirm Next's own output target is unaffected.

*Traces to: NFR-7.*

### S0.3 — Prove the contracts CI job actually runs the contract tests · S

**As a** reviewer, **I want** `cargo test` green in CI, **so that** FR-2.1 is true rather
than configured. The docs previously recorded that the suite would not compile because
`count` and `list` were missing; both now exist, but that has not been demonstrated in CI.

- [ ] A CI run shows the `contracts` job executing `cargo test` with all contract tests passing.
- [ ] The stale "will not compile" note in [README.md](README.md) *(docs index, "Open items")*
      is removed or corrected.

*Traces to: FR-2.1, NFR-7.*

---

## E2 — Finish the advance registry · P0

The backend half is done. These stories are the half a borrower can see.

### S2.1 — Offer the record step after a successful payout · M

**As a** borrower who has just received lira, **I want** to sign a record of what I agreed to,
**so that** I hold proof that does not depend on Stellend's database.

- [ ] After payout succeeds, `BorrowFlow` presents the record step as step 6, using the
      existing `borrow/record/prepare` and `borrow/record/submit` routes.
- [ ] The prompt states what is being signed in plain language: the USDC drawn, the lira
      received, a hash of the payout reference, and the target close date — presented as a
      commitment, not a deadline anything enforces.
- [ ] The step is visibly optional. Declining it is a normal outcome, not an error state.
- [ ] Hidden entirely when `registryEnabled()` is false.

*Traces to: FR-2.3, FR-2.6.*

### S2.2 — Never let the record block the money · M

**As a** borrower, **I want** a failed or declined record to leave my advance complete,
**so that** an optional extra can never cost me the cash I came for.

- [ ] Declining, a wallet rejection, or an RPC failure all leave the advance `active` with
      the fiat leg untouched.
- [ ] `resume` continues to report `registryRecorded: false` without changing `borrowStage`.
- [ ] A test asserts an advance with a failed record is indistinguishable, in every
      money-carrying field, from one with a successful record.

*Traces to: FR-2.4.*

### S2.3 — Make an unrecorded advance recordable later · M

**As a** borrower who skipped the record, **I want** to add it from the loan view, **so that**
declining once is not permanent.

- [ ] The loan view offers "record this advance" whenever `registryRecorded` is false and the
      advance is still open.
- [ ] A retry rebuilds the same `advanceId`; the contract's `AlreadyExists` is treated as
      success, not as an error shown to the borrower.
- [ ] Idempotency is covered by a test that submits the same record twice.

*Traces to: FR-2.3, FR-2.4.*

### S2.4 — Show the record, and say honestly what it proves · M

**As a** borrower, **I want** to see my on-chain record and understand its limits, **so that**
I do not mistake it for the debt itself.

- [ ] The loan view shows recorded / not recorded and links the transaction to an explorer.
- [ ] One line of plain language states the boundary: this proves what was agreed; the pool,
      not this record, is the source of truth for what is still owed.
- [ ] Turkish and English (NFR-6 — this is legally material text).

*Traces to: FR-2.6, NFR-6.*

### S2.5 — Close the record on repayment · M

**As a** borrower who has repaid, **I want** to mark the record settled, **so that** my own
history is accurate.

- [ ] `RepayFlow` offers `mark_repaid` via the existing `registry/close` routes after the
      debt is confirmed settled against the pool.
- [ ] Non-blocking on the same terms as S2.2; a stale `Open` record is a cosmetic cost to the
      borrower and nothing more, and the UI says so rather than nagging.
- [ ] `loans.registry_closed_tx` is populated and surfaced.

*Traces to: FR-2.7.*

### S2.6 — Verify the guards against a hostile client · M

**As a** reviewer, **I want** evidence the registry guards reject tampering, **so that** NFR-2
is demonstrated rather than asserted.

Depends on S0.1 — these tests exist but have never executed.

- [ ] Rejection is proven for each: wrong contract, wrong function, another borrower's
      address, a mismatched advance id, an altered USDC amount, an altered TRY amount.
- [ ] Each rejection writes an audit entry.

*Traces to: NFR-2.*

---

## E5 — A demo a stranger can run · P1

Promoted from P2. A judged submission and a partner engineer fail the same way: they stop at
the first missing environment variable.

### S5.1 — One documented path from clone to both flows completed · M

- [ ] A numbered path in [README.md](README.md) reaching a completed advance *and* a completed
      deposit on testnet in under fifteen minutes.
- [ ] Funding a fresh test wallet and using the sandbox bank are steps in it, not assumed.
- [ ] Walked end to end by someone who has not seen the repository, from the document alone.

*Traces to: FR-5.1, FR-5.2.*

### S5.2 — Fail at startup, with the variable's name · S

- [ ] Missing or malformed configuration fails at boot naming the variable and the shape of a
      valid value — never at the fourth step of a flow.
- [ ] Optional values (`NEXT_PUBLIC_ADVANCE_REGISTRY_ID`) degrade to the feature being absent,
      and that is stated at boot, not silent.

*Traces to: FR-5.3.*

### S5.3 — Say "testnet, mock anchor" inside the running app · S

- [ ] Visible in the application, on every page that moves money, not only in the README.

*Traces to: FR-5.4.*

---

## E3 — Informed consent at borrow time · P1

### S3.1 — Gate the first signature on an acknowledgement · M

**As a** borrower, **I want** the risks before I sign, **so that** I do not discover them from
my position page.

- [ ] Before the first signature: no term and interest accrues from the first ledger; the
      collateral can be sold if its price falls; no liquidator is guaranteed to appear; the
      fee and the anchor's rate.
- [ ] Proceeding requires an explicit acknowledgement — not a scroll, not a hover.
- [ ] Turkish and English.
- [ ] Shown once per advance, not once per session.

*Traces to: FR-3.1, FR-3.2, FR-3.5, NFR-6.*

### S3.2 — Record which wording they saw · S

- [ ] The acknowledgement is written to the audit trail with a disclosure version and timestamp.
- [ ] Given a borrower and an advance, the exact text shown can be reconstructed.

*Traces to: FR-3.3.*

### S3.3 — Let compliance rewrite the text without a deploy · M

- [ ] Disclosure text is versioned content, editable without a code change.
- [ ] Editing it mints a new version; existing acknowledgements keep pointing at the old one.

*Traces to: FR-3.4.*

---

## E1 — Origination fee, end to end · P1

Unchanged from the PRD in content; moved later in sequence. Full requirements in
[PRD.md §5 Epic 1](PRD.md).

### S1.1 — Fee rate as configuration, with a ceiling · S
- [ ] Basis points, documented default 75 bps, hard ceiling 300 bps enforced at startup.
- [ ] 0 bps is valid and disables the feature entirely — no operation, no UI line. *(demo default)*

*Traces to: FR-1.1, FR-1.7.*

### S1.2 — Quote the fee before any signature · M
- [ ] `borrow/start` returns advance amount, fee in USDC and TRY, and net TRY — three fields,
      not one net number.

*Traces to: FR-1.2.*

### S1.3 — Show it as its own line · S
- [ ] Distinct line item beside the amount received; never folded into the rate.

*Traces to: FR-1.3.*

### S1.4 — Collect it during payout · M
- [ ] USDC payment to a configured collection **address** — no server key, ever (NFR-3).
- [ ] In the same signed transaction as the anchor payout where the protocol allows it.

*Traces to: FR-1.4, NFR-3.*

### S1.5 — Guard it · M
- [ ] `txguard` checks destination, asset and an amount matching the server's reserved intent.
- [ ] A client that reduces its own fee is rejected, with a test proving it.

*Traces to: FR-1.5, NFR-2.*

### S1.6 — Put it in history · S
- [ ] Recorded against the advance and visible in transaction history.

*Traces to: FR-1.6.*

---

## E4 — The partner integration seam · P2 · writing, no code

`docs/PARTNER-INTEGRATION.md`. Deliberately last: it describes a system, and the system is
still changing underneath it. Writing it before E1 lands means rewriting it after.

### S4.1 — Name every anchor touchpoint and the SEPs a replacement must implement · M
*Traces to: FR-4.1.*

### S4.2 — Specify where SEP-12 KYC attaches — specification only · M
*Traces to: FR-4.2.*

### S4.3 — State what the partner takes on, without softening it · S
No key custody at any point; the pool is Blend's, not ours; liquidation depends on
third-party liquidators who may not appear for our collateral.
*Traces to: FR-4.3.*

### S4.4 — Show where the revenue split attaches · S
*Traces to: FR-4.4. Depends on E1.*

### S4.5 — List the regulatory questions as questions, not claims · S
CMB licensing, MASAK obligations.
*Traces to: FR-4.5.*

---

## Definition of done

A story is done when all of the following hold. Three of these fail today.

- `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass, and the
  `contracts` job passes.
- Any new signed operation passes through `lib/txguard.ts` with an amount bound in whichever
  direction the step can be gamed, and a test proves a tampered version is rejected (NFR-2).
- Any interruptible step is reported by `resume` and recoverable from the UI (NFR-4).
- No new server-held key (NFR-3), and no personal data on chain (NFR-5).
- Legally material text is in Turkish and English (NFR-6).
- Postgres has not become a second source of truth for debt (NFR-1).

---

## Open, and owned outside this document

1. **When is the hackathon submission due?** It is the only input that decides whether the
   order above is right. Everything else here is defensible without it.
2. **Is the record step worth a fifth signature?** S2.1 ships it optional precisely so the
   answer is observed rather than argued. Folding it into the payout transaction stays live.
3. **Fee in USDC or TRY?** E1 assumes USDC — it is where the borrow lands and avoids a second
   anchor round trip. Revisit when an anchor is real.
4. **Turkish across the whole UI?** NFR-6 takes the narrow option. A partner pilot will not
   accept it.
