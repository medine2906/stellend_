# Business model

Status: proposal. Nothing here is implemented yet — the protocol currently takes zero
revenue. This document exists so the revenue decision is made deliberately rather than
discovered later.

## 1. Who this is for

Two sides of the same Turkish problem, matched through one pool.

**The borrower — "I have crypto, I need lira, I don't want to sell."**
Holds XLM or another Soroban-native asset. Needs cash this month: rent, tuition, stock for
a small business, a tax bill. Selling means realising a gain, paying an exchange fee, and
being out of the position if the price moves. Today the alternatives are a bank consumer
loan (needs a credit file, takes days, rates track policy rates) or selling on an exchange.

Concretely: 25–45, urban, holds crypto worth $2k–$50k, borrows 5,000–50,000 TRY and closes
it within a month or two, repaying from salary or business income, not from trading.

**The lender — "I have lira, and lira loses value."**
Holds TRY in a current or deposit account. Wants dollar exposure plus a yield, without
opening a foreign account and without learning DeFi. Today the alternatives are a TRY
deposit account, buying physical dollars, or a local exchange's staking product.

Concretely: 25–55, has 5,000–250,000 TRY of savings, moves in one or two chunks, and cares
about "can I get it back" far more than about the last two points of yield.

**Who this is not for.** Traders wanting leverage — they are better served by an exchange.
People without crypto — there is no unsecured lending here. Institutions — no custody, no
reporting, no legal wrapper.

## 2. What the product actually does

```
LENDER                                                          BORROWER
  TRY ──bank transfer──▶ anchor ──SEP-38 quote──▶ USDC            XLM ──▶ collateral (Blend)
                                                   │                        │
                                                   ▼                        ▼
                                          ┌──────────────────────────────────────┐
                                          │        Blend v2 lending pool          │
                                          │  supply earns · borrow pays interest  │
                                          └──────────────────────────────────────┘
                                                   │                        │
  TRY ◀──bank──── anchor ◀── USDC ◀── withdraw ────┘                   borrow USDC
                                                                            │
                        TRY ◀──bank──── anchor ◀──SEP-6 withdraw ◀── USDC ──┘
```

The pool sets the interest rate from utilisation. The anchor converts at its own SEP-38
quote. We supply the flow, the UX, and the off-chain record.

## 3. Where the money can come from

Four candidates, with what each would actually earn on a realistic month and what it costs
to build.

| Source | How it works | On 10M TRY/month volume | Build cost | Risk |
|---|---|---|---|---|
| **A. Origination fee** | 0.5–1% of the advance, taken in USDC at borrow time | 50k–100k TRY | Low — one extra transfer in the borrow flow | Visible to the borrower; must be disclosed clearly |
| **B. Ramp spread** | Mark up the anchor's SEP-38 quote by 20–40 bps in each direction | 20k–40k TRY | Low — quote adjustment, but needs anchor agreement | Competes with exchange rates people can check |
| **C. Own Blend pool** | Run our own pool and take the reserve/backstop share of interest | ~1–3% of interest accrued; small until TVL is large | High — pool deployment, parameters, backstop capital, liquidation coverage | Real protocol risk sits with us |
| **D. Lender yield spread** | Keep a slice of the supply APY | Scales with TVL, invisible to the lender | Medium | Least honest of the four; damages the one thing lenders care about |

### Recommendation

**Start with A, add B when there is anchor leverage, treat C as the year-two moat. Do not do D.**

Why:

- **A is the only one that scales with the thing we actually provide.** The borrower's value
  is "cash today without selling". A fee on that is legible, one-off, and easy to disclose:
  "borrow 10,000 TRY, repay 10,000 TRY plus interest, plus a 75 TRY arrangement fee."
- **B needs a partner who does not exist yet.** There is no production TRY anchor on Stellar.
  Spread only becomes available once we have a real anchor relationship, and at that point
  it is negotiated, not assumed.
- **C is the moat but not the starting point.** Running a pool means owning liquidation
  coverage, backstop capital and parameter risk. That is a different company from the one
  that exists today. Worth building toward once TVL justifies it.
- **D is quietly taking from the side that is already carrying FX risk.** It is the easiest
  to implement and the fastest way to lose the lender's trust when they compare numbers.

### Unit economics, at the level of one advance

A 10,000 TRY advance against XLM collateral, closed after about a month:

| Line | Amount |
|---|---|
| Origination fee at 0.75% | 75 TRY |
| Anchor fee (paid by us or passed through) | −20 to −40 TRY |
| Stellar network fees (4 transactions) | < 1 TRY |
| RPC / infra, amortised | −5 TRY |
| **Contribution per advance** | **~30–50 TRY** |

That is thin. It works only at volume or at a higher fee, which is the central open
question: **is 0.75% enough, and will a borrower accept 1.5%?** The comparison in the
borrower's head is not our cost — it is the exchange fee plus the capital gains they avoid
by not selling, which for an appreciated position is often several percent. That is the
argument to test first.

Break-even, roughly: one person, minimal infra, ~1.5M TRY/month of fixed cost coverage
needs roughly 200M TRY of monthly advance volume at 0.75%. That is far beyond a testnet
proof of concept and says plainly that this is not a solo-founder revenue business at
launch — it is a product that needs either a partner's distribution or a higher take rate.

## 4. Why anyone would use it instead of the alternatives

| Alternative | What it costs them | Where we win | Where we lose |
|---|---|---|---|
| Sell crypto on a Turkish exchange | Realised gain, trading fee, out of the position | They keep the position and the upside | Selling is simpler and instant |
| Bank consumer loan | Credit file, days, policy-linked rate | No credit check, minutes not days, no impact on their bank limits | Bank rates may be lower; banks are trusted |
| Exchange-run crypto-backed loan | Custody with the exchange | Non-custodial — keys stay with the user | Exchange has the users already, and a licence |
| Hold TRY in a deposit account (lender) | Real return usually negative | Dollar exposure plus yield | Deposit insurance; we have none |

The honest summary: **our advantage over a licensed Turkish exchange is non-custody and
composability, not price or convenience.** That is a real advantage to a specific, small
group of people. Assuming it is a mass-market advantage would be a mistake.

## 5. What has to be true for this to work

Listed in order of how likely each is to kill the idea.

1. **A licensed TRY on/off-ramp must exist and agree to work with us.** Today the anchor is
   a mock. Without a real one there is no product, only a demo. This is the single
   dependency everything else rests on.
2. **The regulatory position must be resolved.** Turkey's 2024 crypto-asset service provider
   regime (CMB licensing), MASAK/KYC obligations, and the rules around TRY and crypto all
   bear directly on this. Realistically this ships as a feature inside a licensed partner —
   a Turkish exchange or a payment institution — not as an independent product. Every
   revenue model above assumes that partner exists and shares the take.
3. **Borrowers must accept an open-ended debt with liquidation risk.** There is no term:
   interest runs until they repay, and 30 days is a suggestion, not a deadline. Collateral can be sold
   out from under them if the price falls. This has to be understood before signing, not
   discovered after.
4. **Lenders must accept FX risk.** They put in lira and get back dollars-plus-interest
   converted at whatever the rate is then. In most periods this has favoured them. It will
   not always.
5. **The pool must stay liquid enough to withdraw.** The 85% utilisation cap exists for this,
   but a run is still possible.

## 6. Go-to-market, in the order it makes sense

**Phase 0 — now.** Testnet proof of concept. Goal is a credible demo and a grant or
hackathon result, not users. Ship the README, the risk disclosures and the security fixes,
and be explicit that it is not production.

**Phase 1 — partner conversations.** Take the working demo to Turkish exchanges and payment
institutions. The pitch is not "fund us"; it is "you have the licence and the users, we have
the ramp-to-DeFi flow". Revenue model A is the one to put in front of them, because it is
the one they can price.

**Phase 2 — pilot with a real anchor.** Small caps (e.g. 50,000 TRY per advance), a
whitelist of collateral, manual monitoring. Measure the one number that matters: what share
of borrowers repay before liquidation.

**Phase 3 — own pool.** Only after Phase 2 shows the loan book behaves. This is where
revenue model C, and an actual moat, become available.

## 7. What is deliberately not being built

- **Unsecured lending.** No credit model, no recovery mechanism, no licence.
- **A liquidation bot.** Blend's own liquidators handle it. If they do not show up for our
  collateral in practice, that becomes a Phase 2 finding, not a Phase 0 assumption.
- **Custody.** The moment we hold keys, we are a different regulated thing.
- **Mainnet.** Not until 1 and 2 above are resolved.
