# Stellend documentation

Start with [../README.md](../README.md) — what the product is, how to run it, and the
limitations that are deliberate. Everything here goes a level deeper.

## By what you are trying to do

**"I want to understand how this works."**
→ [ARCHITECTURE.md](ARCHITECTURE.md). The trust model, the prepare/submit pattern, the
cash advance end to end, and how an interrupted advance is resumed.

**"I'm calling the API."**
→ [API.md](API.md). Every route, its body, its auth, and the error contract.

**"I'm touching the database."**
→ [DATA-MODEL.md](DATA-MODEL.md). Tables, status machines, why the borrow intent row is
special, and how to apply the schema safely.

**"What's this Rust directory?"**
→ [CONTRACT-ADVANCE-REGISTRY.md](CONTRACT-ADVANCE-REGISTRY.md). Reference for the Soroban
contract that gives the borrower an independent copy of their own record: functions,
errors, storage, and what it deliberately refuses to do. Not yet wired in.
→ [ARCHITECTURE-advance-registry.md](ARCHITECTURE-advance-registry.md) is the companion
design for *how* it gets wired in, and what the registry is allowed to be believed about.

**"What are we building next, and why that?"**
→ [PRD.md](PRD.md). The Phase 0 → Phase 1 scope call, framed around what a licensed partner
will ask.

**"Why Blend? Why no loan term? Is there really no TRY anchor?"**
→ [ECOSYSTEM.md](ECOSYSTEM.md). What we depend on in the Stellar ecosystem, what it
constrains, and who the neighbours are.

**"Who is this for, and how would it make money?"**
→ [BUSINESS-MODEL.md](BUSINESS-MODEL.md). Both sides of the user, four revenue candidates
with a recommendation, unit economics, and what has to be true for any of it to work.

## Reading order for someone new

1. [../README.md](../README.md) — the product and its limits
2. [ARCHITECTURE.md](ARCHITECTURE.md) — the machinery
3. [DATA-MODEL.md](DATA-MODEL.md) — what is stored and what is not
4. [API.md](API.md) — the surface
5. [ECOSYSTEM.md](ECOSYSTEM.md) and [BUSINESS-MODEL.md](BUSINESS-MODEL.md) — the context
6. [PRD.md](PRD.md) — what happens next

## Three facts that explain most decisions

- **This is a testnet proof of concept.** Stellar testnet, a Blend testnet pool, a mock TRY
  anchor. Do not point it at mainnet.
- **The server holds no key.** The wallet signs; the server prepares and verifies.
- **The chain is authoritative.** Postgres is a cache, except for the borrow intent.

## Open items the docs call out

Found while writing these pages, recorded rather than silently fixed:

- The `SESSION_COOKIE_SECRET` comment in [../.env.example](../.env.example) says the
  session cookie is HMAC-signed; it is AES-256-GCM encrypted
  ([ARCHITECTURE.md](ARCHITECTURE.md#session-and-identity)).
- The `advance-registry` test suite calls `count` and a paged `list` that `lib.rs` does not
  define, so `cargo test` will not compile
  ([CONTRACT-ADVANCE-REGISTRY.md](CONTRACT-ADVANCE-REGISTRY.md#build-and-test)).
- `NEXT_PUBLIC_ADVANCE_REGISTRY_ID` is published in `.env.example` but no code reads it.
