#![no_std]
//! # Advance registry
//!
//! Stellend keeps its advance records in Postgres, and that is a real weakness: the
//! borrower's side of the agreement — how much fiat they were paid, against how much
//! debt, and when they said they would close it — exists only in a table we control.
//! Nothing stops the operator rewriting it after the fact, and a borrower has no
//! independent copy to point at.
//!
//! This contract is that independent copy. On the last step of an advance the borrower
//! signs a record of what they just agreed to, and it lands on chain under their own
//! authorisation. Neither the operator nor a later database migration can alter it.
//!
//! What it deliberately does **not** do:
//!
//! - It does not hold funds, and it cannot move any. The debt lives in the Blend pool.
//! - It does not enforce the target close date. Blend is a perpetual market; nothing
//!   on Stellar can make a position close on a date. `due_at` is a commitment the
//!   borrower signed, not a trigger, and [`Self::is_overdue`] only reports the fact.
//! - It is not the source of truth for whether a debt is outstanding. The pool is.
//!   A borrower who never calls [`Self::mark_repaid`] leaves a stale `Open` record;
//!   that costs them their own good standing and nothing else.
//!
//! Storage layout: one persistent entry per advance keyed by its id, plus one
//! persistent index per borrower. Both are TTL-extended on every write and on read,
//! so an advance that is still being serviced cannot be archived out from under us.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env, Vec,
};

/// ~5s ledgers: bump entries back up to ~60 days whenever they come within ~30 days
/// of expiry. An advance is expected to close well inside that window.
const TTL_THRESHOLD: u32 = 518_400;
const TTL_EXTEND_TO: u32 = 1_036_800;

/// Upper bound on how far ahead a borrower may set their target close date (~1 year).
/// Guards against a fat-fingered timestamp being recorded as a commitment.
const MAX_TERM_SECONDS: u64 = 31_536_000;

/// Most advance ids one [`AdvanceRegistry::list`] call will return.
const MAX_PAGE: u32 = 100;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// An advance with this id is already recorded. Ids are content-addressed by the
    /// caller, so a repeat means a replayed request, not a new advance.
    AlreadyExists = 1,
    /// No advance with this id.
    NotFound = 2,
    /// Amounts must be strictly positive.
    InvalidAmount = 3,
    /// The target close date is in the past, or absurdly far in the future.
    InvalidDueDate = 4,
    /// The advance has already been closed out; it cannot be closed twice.
    NotOpen = 5,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    /// Recorded and not yet closed by the borrower.
    Open = 0,
    /// The borrower has declared the debt settled.
    Repaid = 1,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Advance {
    /// The account that signed this record and that holds the debt in the pool.
    pub borrower: Address,
    /// Debt drawn from the pool, in USDC stroops (7 decimal places).
    pub usdc_amount: i128,
    /// Fiat paid out by the anchor, in TRY minor units (2 decimal places).
    pub try_amount: i128,
    /// Hash of the anchor's withdrawal id and destination. A hash, not the values:
    /// an IBAN is personal data and has no business being on a public ledger, but a
    /// borrower holding the originals can still prove which payout this record covers.
    pub payout_ref: BytesN<32>,
    /// Ledger timestamp at which the record was written.
    pub opened_at: u64,
    /// The close date the borrower committed to. Not enforced — see the module docs.
    pub due_at: u64,
    pub status: Status,
}

#[contracttype]
enum DataKey {
    /// Advance by id.
    Advance(BytesN<32>),
    /// How many advances this borrower has opened.
    Count(Address),
    /// The borrower's n-th advance id, oldest first.
    At(Address, u32),
}

/// Emitted when a borrower records a new advance. `borrower` is a topic so an
/// indexer can follow one account without replaying the whole ledger.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Opened {
    #[topic]
    pub borrower: Address,
    pub id: BytesN<32>,
    pub usdc_amount: i128,
    pub try_amount: i128,
    pub due_at: u64,
}

/// Emitted when a borrower declares an advance settled.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Repaid {
    #[topic]
    pub borrower: Address,
    pub id: BytesN<32>,
}

#[contract]
pub struct AdvanceRegistry;

#[contractimpl]
impl AdvanceRegistry {
    /// Records an advance the borrower has just taken.
    ///
    /// Authorised by `borrower`, never by the operator: a record can only be written
    /// by the account it is about. That is the whole point — a row in our database
    /// claims the borrower agreed to something, whereas this proves it.
    ///
    /// `id` is chosen by the caller and must be unique; Stellend uses a hash derived
    /// from the borrow intent, which makes a retried submission idempotent rather
    /// than duplicating the record.
    pub fn open(
        env: Env,
        borrower: Address,
        id: BytesN<32>,
        usdc_amount: i128,
        try_amount: i128,
        payout_ref: BytesN<32>,
        due_at: u64,
    ) -> Result<(), Error> {
        borrower.require_auth();

        if usdc_amount <= 0 || try_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let now = env.ledger().timestamp();
        if due_at <= now || due_at > now + MAX_TERM_SECONDS {
            return Err(Error::InvalidDueDate);
        }

        let key = DataKey::Advance(id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyExists);
        }

        let advance = Advance {
            borrower: borrower.clone(),
            usdc_amount,
            try_amount,
            payout_ref,
            opened_at: now,
            due_at,
            status: Status::Open,
        };
        env.storage().persistent().set(&key, &advance);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        // The index is one entry per position rather than one growing Vec: appending
        // costs the same whether it is a borrower's first advance or their hundredth,
        // and two borrowers opening advances at once touch disjoint ledger entries.
        let count_key = DataKey::Count(borrower.clone());
        let next: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);

        let at_key = DataKey::At(borrower.clone(), next);
        env.storage().persistent().set(&at_key, &id);
        env.storage()
            .persistent()
            .extend_ttl(&at_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.storage().persistent().set(&count_key, &(next + 1));
        env.storage()
            .persistent()
            .extend_ttl(&count_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        Opened {
            borrower,
            id,
            usdc_amount,
            try_amount,
            due_at,
        }
        .publish(&env);

        Ok(())
    }

    /// Marks an advance settled. Authorised by the borrower, because only they can
    /// make a claim about their own record; the pool remains the authority on whether
    /// the debt is actually gone.
    pub fn mark_repaid(env: Env, id: BytesN<32>) -> Result<(), Error> {
        let key = DataKey::Advance(id.clone());
        let mut advance: Advance = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;

        advance.borrower.require_auth();

        if advance.status != Status::Open {
            return Err(Error::NotOpen);
        }

        advance.status = Status::Repaid;
        let borrower = advance.borrower.clone();
        env.storage().persistent().set(&key, &advance);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        Repaid { borrower, id }.publish(&env);

        Ok(())
    }

    /// The advance as recorded. Reading extends its TTL, so an advance anyone is still
    /// watching stays alive.
    pub fn get(env: Env, id: BytesN<32>) -> Result<Advance, Error> {
        let key = DataKey::Advance(id);
        let advance: Advance = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(advance)
    }

    /// Whether an open advance is past the date its borrower committed to. Reporting
    /// only: nothing in this contract, or in Blend, acts on the answer.
    pub fn is_overdue(env: Env, id: BytesN<32>) -> Result<bool, Error> {
        let advance = Self::get(env.clone(), id)?;
        Ok(advance.status == Status::Open && env.ledger().timestamp() > advance.due_at)
    }

    /// How many advances this borrower has recorded. Zero for an unknown account
    /// rather than an error — "none" is a valid answer, not a failure.
    pub fn count(env: Env, borrower: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Count(borrower))
            .unwrap_or(0)
    }

    /// A page of this borrower's advance ids, oldest first, starting at `start`.
    ///
    /// Paged rather than "all of them" on purpose: every read declares its ledger
    /// footprint upfront, so an unbounded list would make the cost of reading one
    /// borrower's history grow without limit. `limit` is clamped to [`MAX_PAGE`], and
    /// a `start` past the end returns empty rather than failing.
    pub fn list(env: Env, borrower: Address, start: u32, limit: u32) -> Vec<BytesN<32>> {
        let total = Self::count(env.clone(), borrower.clone());
        let mut ids = Vec::new(&env);
        if start >= total {
            return ids;
        }

        let end = start.saturating_add(limit.min(MAX_PAGE)).min(total);
        for i in start..end {
            let key = DataKey::At(borrower.clone(), i);
            if let Some(id) = env.storage().persistent().get::<_, BytesN<32>>(&key) {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
                ids.push_back(id);
            }
        }
        ids
    }
}

mod test;
