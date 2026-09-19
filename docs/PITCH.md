# Stellend — pitch deck

Slide-by-slide content for the official Stellar Pro Hackathon template. Copy each
slide's body into the matching template slide; the **Notes** lines are what you say out
loud, not text to put on the slide.

Two things to fill in before you present: the live demo URL, and team names/contacts.
They are marked `‹…›`.

---

## Slide 1 — Title

**Stellend**

Turkish lira in and out of a Stellar lending pool.

Genesis Track · Stellar Testnet · ‹demo URL› · github.com/medine2906/stellend_

> **Notes:** One sentence, then move. "We put Turkish lira into a Stellar lending pool,
> and take it back out again." Don't explain DeFi yet.

---

## Slide 2 — The problem

Two people, one country, opposite problems, no product between them.

- **"I have crypto. I need lira this month. I don't want to sell."**
  Selling means realising the gain, paying the exchange fee, and losing the position.
  A bank loan needs a credit file and takes days.
- **"I have lira. Lira loses value."**
  A deposit account's real return is usually negative. Dollar exposure plus a yield
  means opening a foreign account or learning DeFi.

> **Notes:** These are the same person's neighbours, not a niche. Turkey has one of the
> highest crypto-ownership rates in the world *because* of the second problem.

---

## Slide 3 — Who this is for

| | Borrower | Lender |
|---|---|---|
| Holds | $2k–$50k of crypto | 5,000–250,000 TRY of savings |
| Wants | 5,000–50,000 TRY for ~30 days | Dollar exposure + yield |
| Repays from | Salary or business income | — |
| Cares most about | Keeping the position | "Can I get it back" |

Not for: traders wanting leverage, people without crypto, institutions.

> **Notes:** Say who it is *not* for. It signals you have thought about the market
> rather than claiming everyone.

---

## Slide 4 — What we built

One pool, two flows, both non-custodial.

- **Cash advance** — lock collateral, borrow USDC from a Blend v2 pool, the anchor pays
  the lira to your bank account.
- **Lira savings** — send TRY by bank transfer, the anchor converts it to USDC, it is
  supplied to the same pool as lending liquidity.

The borrower's lira comes from the lender's lira. The pool sets the rate from
utilisation. We supply the flow, the UX and the record.

> **Notes:** Emphasise "one pool". The two sides are not separate products; the lender
> funds the borrower.

---

## Slide 5 — Demo

Live, on testnet, end to end:

1. Connect wallet → SEP-10 authenticates against the anchor
2. Request 10,000 TRY → SEP-38 quote, SEP-6 withdrawal reserved
3. Sign collateral → sign borrow → sign payout *(three wallet signatures)*
4. Anchor sends TRY to the IBAN; the advance goes `active`
5. The registry contract, invoked directly on testnet, holding a borrower-signed record

> **Notes:** Have the wallet already connected and the sandbox bank open in a second
> tab. If the RPC is slow, talk over step 3 — the testnet RPC 502s occasionally and
> that is not your bug. Step 5 is currently shown from the explorer, not from the UI:
> the registry is deployed and working but the borrow flow does not call it yet. Say
> that rather than implying otherwise — a judge who checks will check.

---

## Slide 6 — Architecture

*(Use the Mermaid diagram from the README — render it and paste as an image.)*

- **Wallet signs everything.** The server builds unsigned XDR; no private key ever
  reaches the application.
- **The chain is authoritative.** Supabase is a cache. Where they disagree, the code
  reads the pool.
- **Every signed transaction is verified before submission** — right source, right
  contract, right action, right amount.

> **Notes:** If a judge asks one technical question, it will be about custody. Answer:
> we never hold keys and we never hold funds; the debt is in Blend, the fiat is at the
> anchor.

---

## Slide 7 — Stellar integration

Three integrations, all load-bearing — remove any one and there is no product.

| Layer | What | Why it matters |
|---|---|---|
| **Blend v2** | The lending pool: supply, borrow, repay, withdraw | The yield and the credit both come from here. We did not build a lending protocol; we made an existing one reachable in lira |
| **Anchor (SEP-10/6/38)** | TRY ↔ USDC, both directions, to a real bank account | This is the edge that separates a crypto demo from a product |
| **Advance registry** | Our own Soroban contract | The borrower's commitment, signed by them, on chain |

> **Notes:** Anchor integration carries the highest weight in the judging criteria.
> Lead with it if you are short on time.

---

## Slide 8 — The contract we wrote

`contracts/advance-registry` — deployed at
`CC2F5JAI2REPM4CMKLSI3EMFBNHVMPOEVY7GARSCHTNHEOL536NOVWQF`

**The problem it solves:** the borrower's side of the agreement — how much fiat, against
how much debt, closing when — lived only in *our* Postgres table. Nothing stopped us
rewriting it. The borrower had no independent copy.

**What it does:** the borrower signs the record themselves. No admin key, so there is
nothing for us to abuse. The IBAN is stored as a hash, not in the clear.

**What it honestly does not do:** hold funds, move funds, or enforce the date. Blend is
a perpetual market; nothing on Stellar can force a position to close on a day.

> **Notes:** The last line is the one that earns credit. Most teams overclaim what their
> contract enforces. Saying what it *cannot* do makes the rest believable.

---

## Slide 9 — What was actually hard

- **Soroban state archival.** Blend's ledger entries expire. A borrow simulation fails
  with expired footprints, so the flow detects it, hands back a restore transaction,
  and re-prepares. Without this the borrow flow simply stops working after a while.
- **A resumable multi-transaction flow.** An advance is four signatures and a bank
  transfer. If the browser dies between "borrowed the USDC" and "paid it to the anchor",
  the user has debt and no cash. `/api/loans/borrow/resume` reports the exact step and
  the UI picks it up.
- **Not trusting our own client.** The wallet can only spend its own funds, but it could
  *misreport* what it spent. Amounts now come from the server's reserved intent, and
  every signed transaction is decoded and checked against it before submission.

> **Notes:** Pick one and go deep if asked. The resumable-flow one is the most
> product-minded; the archival one is the most Soroban-specific.

---

## Slide 10 — Quality

- **122 tests** — 110 on the app, 12 on the contract. CI runs both plus typecheck,
  lint and a production build on every push.
- **Known limitations documented in the README**, not hidden: the anchor is a mock,
  there is no KYC, there is no liquidation bot, and nothing enforces a due date.

> **Notes:** The limitations list is a strength. Say so: "we would rather you read our
> risks from our README than find them in our demo."

---

## Slide 11 — Business model

Start with an origination fee (0.5–1% of the advance), add a ramp spread once there is
a real anchor relationship, run our own pool only when TVL justifies it.

On a 10,000 TRY advance at 0.75%: 75 TRY in, ~30–50 TRY contribution after anchor and
network costs.

That is thin, and it says something true: this is not a solo revenue business at launch.
It needs a licensed partner's distribution.

> **Notes:** Full reasoning, including the model we rejected, is in
> docs/BUSINESS-MODEL.md. If a judge asks "why not take a slice of the lender's yield" —
> because it is invisible, and it takes from the side already carrying FX risk.

---

## Slide 12 — What has to be true

In order of how likely each is to kill it:

1. **A licensed TRY anchor must exist and work with us.** Today it is a mock. This is
   the single dependency everything rests on.
2. **The regulatory position must resolve.** Turkey's CMB licensing regime and MASAK
   obligations mean this realistically ships *inside* a licensed partner.
3. Borrowers must accept liquidation risk; lenders must accept FX risk; the pool must
   stay liquid enough to withdraw.

> **Notes:** Do not soften this. Every investor in the room already knows it, and saying
> it first is what makes the rest of the pitch credible.

---

## Slide 13 — Roadmap

- **Now** — testnet proof of concept. Credible demo, honest docs.
- **Next** — partner conversations with Turkish exchanges and payment institutions.
  The pitch is not "fund us"; it is "you have the licence and the users, we have the
  ramp-to-DeFi flow".
- **Then** — pilot with a real anchor: small caps, whitelisted collateral, manual
  monitoring. Measure the one number that matters — what share of borrowers repay
  before liquidation.
- **Later** — our own Blend pool, once the loan book has behaved.

**Intended next step: SCF Build Award**, with InstAward as the nearer-term path.

> **Notes:** Name SCF explicitly — the judging criteria asks for it.

---

## Slide 14 — Team & links

‹Name — role — contact› *(up to 4 for Genesis)*

- Repo: github.com/‹repo›
- Live demo: ‹demo URL›
- Registry contract: [stellar.expert](https://stellar.expert/explorer/testnet/contract/CC2F5JAI2REPM4CMKLSI3EMFBNHVMPOEVY7GARSCHTNHEOL536NOVWQF)
- Blend pool: `CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW`
- Anchor: tr-mock-anchor.fly.dev
- Stellar skills used: `skills/smart-contracts/SKILL.md`, `skills/smart-contracts/development.md`, `skills/standards/SKILL.md`, `skills/dapp/SKILL.md`

> **Notes:** Leave this slide up during questions so the judges can find the links.
