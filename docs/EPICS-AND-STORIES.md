# Stellend — ship list

Submission day, 2026-09-20. Hours, not days.

This file was a backlog. It is now a cut list, because the backlog got delivered while it was
being written. Everything scoped for this cycle is done; what remains is submission work, and
most of it is not code.

The deferred backlog is kept at the bottom so nothing is lost after the deadline.

---

## Status

Verified in the working tree, which is clean — 16 suites, 139 tests passing, typecheck and
lint green.

| Epic | State |
|---|---|
| **E0 — unblock the build** | **Done.** The duplicate `USDC` binding is gone, the registry guards moved to `test/txguardRegistry.test.ts` (18 tests, running), and typecheck passes. |
| **E2 — advance registry** | **Done, end to end.** Contract deployed; `lib/registry.ts`; four routes; `txguard` guards `open` and `mark_repaid`; the record is offered in `BorrowFlow` after payout and retryable from `LoansList`; `mark_repaid` is offered on a repaid loan; failure text says *"your cash advance is unaffected"*. |
| **E1 — origination fee** | **Cut.** See below. |
| **E3 — informed consent gate** | **Cut.** See below. |
| **E4 — partner integration doc** | **Cut.** Post-deadline. |
| **E5 — demo path** | **Effectively done** via the README's Getting started and Deployed artifacts sections. One smoke test remains — S-2. |

---

## What is cut, and why

**E1 (fee) and E3 (consent gate) both touch the signing path.** Hours before a judged demo,
a change there has negative expected value: the upside is a feature nobody asked to see, and
the downside is the flow that the entire submission rests on. Neither is a gap a judge will
name — the fee is a business-model question already answered in
[BUSINESS-MODEL.md](BUSINESS-MODEL.md), and the risk disclosure is covered in the README's
Known limitations and on the pitch's risk slide.

**E4** is writing about a system, for an audience that is not in this room today.

The three open items in [README.md](README.md) *(docs index)* — the registry has no read path,
nothing reconciles `registry_tx` against the chain, and `due_at` is read at signing time — stay
open and stay documented. Naming a limitation is worth more in a judged submission than
half-fixing it at 3am, and all three are already written down honestly.

**Freeze rule for the remaining hours: no commits to `components/BorrowFlow.tsx`,
`components/RepayFlow.tsx`, `lib/txguard.ts`, `lib/blend.ts` or any `prepare`/`submit` route.**
If something in those files is broken, that is a finding, not a task — decide deliberately,
do not patch reflexively.

---

## What is left, in order

### S-1 · Fill the pitch placeholders · **blocks submission** · only you can do this

[PITCH.md](PITCH.md) has four `‹…›` markers and the deck cannot be handed in with them:

- line 18 — `‹demo URL›` on the title slide
- line 226 — `‹Name — role — contact›`, up to four people for Genesis
- line 228 — `github.com/‹repo›`
- line 229 — `‹demo URL›` again, on the closing slide

The repo slug appears as `github.com/medine2906/stellend_` on line 18 — confirm the trailing
underscore is real and make both references identical.

### S-2 · Smoke-test the live deployment, not localhost · **blocks submission**

A Vercel project named `stellend` is configured. Before the URL goes on a slide, complete
**one advance and one deposit against the deployed build**, not a dev server:

- [ ] Connect wallet, SEP-10 authenticates
- [ ] Advance completes through payout, lira lands in the sandbox bank
- [ ] The record offer appears after payout and signs successfully
- [ ] Deposit completes and supplies the pool
- [ ] The testnet / mock-anchor notice is visible on the deployed site

A demo URL nobody has driven end to end is the single most common way a submission fails in
front of judges.

### S-3 · Record the demo · strongly recommended

Live demos fail on conference wifi and on wallet extensions. Record the S-2 run as you do it.
If the submission allows a video, this is the video; if it does not, it is the fallback.

### S-4 · Read the pitch out loud once · cheap

[PITCH.md](PITCH.md) carries speaker notes per slide. Reading it aloud once is the only way to
find the slide you cannot actually explain in the time you have.

---

## Deferred — the real backlog, after the deadline

Unchanged in substance from the version this file replaced; full requirements live in
[PRD.md](PRD.md).

**E1 — origination fee.** Rate as basis points with a 300 bps ceiling and a 0 bps default;
quoted before any signature as three fields, not one net number; shown as its own line, never
folded into the rate; collected as USDC to a configured **address** during payout — no server
key, ever (NFR-3); guarded by `txguard` against a client that reduces its own fee; visible in
history. *FR-1.1 – FR-1.7.*

**E3 — informed consent at borrow time.** Four facts before the first signature — no term and
interest from the first ledger, collateral can be sold, no liquidator is guaranteed, the fee
and the rate. Explicit acknowledgement, recorded with a disclosure version, text editable
without a deploy, shown once per advance. Turkish and English. *FR-3.1 – FR-3.5, NFR-6.*

**E4 — partner integration seam.** `docs/PARTNER-INTEGRATION.md`: every anchor touchpoint and
the SEPs a replacement must implement; where SEP-12 KYC attaches, as specification only; what
the partner takes on, unsoftened; where the revenue split attaches; the regulatory questions
as questions. *FR-4.1 – FR-4.5.*

**The three known gaps**, each already documented rather than hidden: give the registry a read
path so a borrower can see their own record; reconcile `registry_tx` against the chain the way
loans already get a keeper; stop `due_at` diverging from the on-chain commitment when a loan
row is edited after signing.

---

## Definition of done, for what shipped

All six held for E0 and E2, which is why they are done:

- typecheck, lint, test, build and the `contracts` job all pass
- every new signed operation passes `lib/txguard.ts` with a test proving a tampered version is
  rejected (NFR-2)
- every interruptible step is reported by `resume` and recoverable from the UI (NFR-4)
- no server-held key (NFR-3), no personal data on chain (NFR-5)
- the chain stayed authoritative; Postgres did not become a second source of truth (NFR-1)
