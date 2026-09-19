#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env,
};

const DAY: u64 = 86_400;

struct Fixture {
    env: Env,
    client: AdvanceRegistryClient<'static>,
    borrower: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);

    let contract_id = env.register(AdvanceRegistry, ());
    let client = AdvanceRegistryClient::new(&env, &contract_id);
    let borrower = Address::generate(&env);

    Fixture {
        env,
        client,
        borrower,
    }
}

fn id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// 10,000 USDC in stroops, and 350,000.00 TRY in minor units.
const USDC: i128 = 10_000_0000000;
const TRY: i128 = 350_000_00;

#[test]
fn open_records_what_the_borrower_signed() {
    let f = setup();
    let advance_id = id(&f.env, 1);
    let due = f.env.ledger().timestamp() + 30 * DAY;

    f.client.open(
        &f.borrower,
        &advance_id,
        &USDC,
        &TRY,
        &id(&f.env, 9),
        &due,
    );

    let stored = f.client.get(&advance_id);
    assert_eq!(stored.borrower, f.borrower);
    assert_eq!(stored.usdc_amount, USDC);
    assert_eq!(stored.try_amount, TRY);
    assert_eq!(stored.payout_ref, id(&f.env, 9));
    assert_eq!(stored.opened_at, 1_700_000_000);
    assert_eq!(stored.due_at, due);
    assert_eq!(stored.status, Status::Open);
}

#[test]
fn open_requires_the_borrower_s_own_signature() {
    let env = Env::default();
    env.ledger().set_timestamp(1_700_000_000);
    let contract_id = env.register(AdvanceRegistry, ());
    let client = AdvanceRegistryClient::new(&env, &contract_id);
    let borrower = Address::generate(&env);

    // No mock_all_auths: nobody has authorised anything, so the write must not land.
    let result = client.try_open(
        &borrower,
        &id(&env, 1),
        &USDC,
        &TRY,
        &id(&env, 9),
        &(env.ledger().timestamp() + 30 * DAY),
    );
    assert!(result.is_err());
}

#[test]
fn an_id_can_only_be_used_once() {
    let f = setup();
    let advance_id = id(&f.env, 1);
    let due = f.env.ledger().timestamp() + 30 * DAY;

    f.client
        .open(&f.borrower, &advance_id, &USDC, &TRY, &id(&f.env, 9), &due);

    // A retried submit must not write a second record for the same advance.
    let again = f
        .client
        .try_open(&f.borrower, &advance_id, &USDC, &TRY, &id(&f.env, 9), &due);
    assert_eq!(again, Err(Ok(Error::AlreadyExists)));

    assert_eq!(f.client.count(&f.borrower), 1);
}

#[test]
fn amounts_must_be_positive() {
    let f = setup();
    let due = f.env.ledger().timestamp() + 30 * DAY;

    assert_eq!(
        f.client
            .try_open(&f.borrower, &id(&f.env, 1), &0, &TRY, &id(&f.env, 9), &due),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        f.client
            .try_open(&f.borrower, &id(&f.env, 2), &USDC, &-1, &id(&f.env, 9), &due),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn a_due_date_must_be_ahead_and_not_absurd() {
    let f = setup();
    let now = f.env.ledger().timestamp();

    assert_eq!(
        f.client.try_open(
            &f.borrower,
            &id(&f.env, 1),
            &USDC,
            &TRY,
            &id(&f.env, 9),
            &(now - 1)
        ),
        Err(Ok(Error::InvalidDueDate))
    );
    assert_eq!(
        f.client
            .try_open(&f.borrower, &id(&f.env, 2), &USDC, &TRY, &id(&f.env, 9), &now),
        Err(Ok(Error::InvalidDueDate))
    );
    assert_eq!(
        f.client.try_open(
            &f.borrower,
            &id(&f.env, 3),
            &USDC,
            &TRY,
            &id(&f.env, 9),
            &(now + MAX_TERM_SECONDS + 1)
        ),
        Err(Ok(Error::InvalidDueDate))
    );
}

#[test]
fn marking_repaid_closes_the_record_once() {
    let f = setup();
    let advance_id = id(&f.env, 1);
    f.client.open(
        &f.borrower,
        &advance_id,
        &USDC,
        &TRY,
        &id(&f.env, 9),
        &(f.env.ledger().timestamp() + 30 * DAY),
    );

    f.client.mark_repaid(&advance_id);
    assert_eq!(f.client.get(&advance_id).status, Status::Repaid);

    assert_eq!(
        f.client.try_mark_repaid(&advance_id),
        Err(Ok(Error::NotOpen))
    );
}

#[test]
fn a_repaid_advance_is_never_overdue() {
    let f = setup();
    let advance_id = id(&f.env, 1);
    let due = f.env.ledger().timestamp() + 30 * DAY;
    f.client
        .open(&f.borrower, &advance_id, &USDC, &TRY, &id(&f.env, 9), &due);

    f.client.mark_repaid(&advance_id);
    f.env.ledger().set_timestamp(due + DAY);

    assert!(!f.client.is_overdue(&advance_id));
}

#[test]
fn overdue_flips_only_after_the_committed_date() {
    let f = setup();
    let advance_id = id(&f.env, 1);
    let due = f.env.ledger().timestamp() + 30 * DAY;
    f.client
        .open(&f.borrower, &advance_id, &USDC, &TRY, &id(&f.env, 9), &due);

    assert!(!f.client.is_overdue(&advance_id));

    f.env.ledger().set_timestamp(due);
    assert!(!f.client.is_overdue(&advance_id), "due exactly now is not late");

    f.env.ledger().set_timestamp(due + 1);
    assert!(f.client.is_overdue(&advance_id));
}

#[test]
fn unknown_ids_report_not_found() {
    let f = setup();
    assert_eq!(f.client.try_get(&id(&f.env, 7)), Err(Ok(Error::NotFound)));
    assert_eq!(
        f.client.try_is_overdue(&id(&f.env, 7)),
        Err(Ok(Error::NotFound))
    );
    assert_eq!(
        f.client.try_mark_repaid(&id(&f.env, 7)),
        Err(Ok(Error::NotFound))
    );
}

#[test]
fn the_index_is_per_borrower_and_ordered() {
    let f = setup();
    let other = Address::generate(&f.env);
    let due = f.env.ledger().timestamp() + 30 * DAY;

    f.client
        .open(&f.borrower, &id(&f.env, 1), &USDC, &TRY, &id(&f.env, 9), &due);
    f.client
        .open(&f.borrower, &id(&f.env, 2), &USDC, &TRY, &id(&f.env, 9), &due);
    f.client
        .open(&other, &id(&f.env, 3), &USDC, &TRY, &id(&f.env, 9), &due);

    let mine = f.client.list(&f.borrower, &0, &10);
    assert_eq!(mine.len(), 2);
    assert_eq!(mine.get(0).unwrap(), id(&f.env, 1));
    assert_eq!(mine.get(1).unwrap(), id(&f.env, 2));

    assert_eq!(f.client.count(&f.borrower), 2);
    assert_eq!(f.client.count(&other), 1);

    // One borrower's history never leaks into another's.
    assert_eq!(f.client.list(&other, &0, &10).get(0).unwrap(), id(&f.env, 3));

    let stranger = Address::generate(&f.env);
    assert_eq!(f.client.count(&stranger), 0);
    assert_eq!(f.client.list(&stranger, &0, &10).len(), 0);
}

#[test]
fn listing_is_paged_and_clamped() {
    let f = setup();
    let due = f.env.ledger().timestamp() + 30 * DAY;
    for i in 1..=5u8 {
        f.client
            .open(&f.borrower, &id(&f.env, i), &USDC, &TRY, &id(&f.env, 9), &due);
    }

    let page = f.client.list(&f.borrower, &1, &2);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap(), id(&f.env, 2));
    assert_eq!(page.get(1).unwrap(), id(&f.env, 3));

    // A window running off the end stops at the end instead of failing.
    let tail = f.client.list(&f.borrower, &4, &50);
    assert_eq!(tail.len(), 1);
    assert_eq!(tail.get(0).unwrap(), id(&f.env, 5));

    // Starting past the end is empty, not an error.
    assert_eq!(f.client.list(&f.borrower, &5, &10).len(), 0);
    assert_eq!(f.client.list(&f.borrower, &999, &10).len(), 0);

    // A limit far above the cap cannot be used to force an unbounded read.
    assert_eq!(f.client.list(&f.borrower, &0, &u32::MAX).len(), 5);
}

#[test]
fn a_borrower_cannot_close_someone_else_s_advance() {
    let env = Env::default();
    env.ledger().set_timestamp(1_700_000_000);
    let contract_id = env.register(AdvanceRegistry, ());
    let client = AdvanceRegistryClient::new(&env, &contract_id);
    let borrower = Address::generate(&env);
    let advance_id = id(&env, 1);

    env.mock_all_auths();
    client.open(
        &borrower,
        &advance_id,
        &USDC,
        &TRY,
        &id(&env, 9),
        &(env.ledger().timestamp() + 30 * DAY),
    );

    // Drop the blanket mock: mark_repaid must now fail for want of the borrower's auth.
    let env2 = env.clone();
    env2.set_auths(&[]);
    assert!(client.try_mark_repaid(&advance_id).is_err());
}
