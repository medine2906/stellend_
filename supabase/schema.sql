-- Stellend off-chain indexer schema.
-- Source of truth for balances/loans is always the Stellar chain + anchor;
-- these tables only cache state for a fast UI.

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  stellar_public_key text not null unique,
  created_at timestamptz not null default now()
);

-- Sandbox bank account linked to the wallet; cash advances are paid out to this IBAN.
alter table profiles add column if not exists sandbox_iban text;
alter table profiles add column if not exists sandbox_holder text;
alter table profiles add column if not exists sandbox_created_at timestamptz;

-- Money spent from the sandbox bank account; balance = advances received - sum(amount).
create table if not exists sandbox_spends (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  amount numeric not null check (amount > 0),
  description text not null default '',
  created_at timestamptz not null default now()
);
alter table sandbox_spends enable row level security;

create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references profiles (id) on delete cascade,
  collateral_asset text not null,
  collateral_amount numeric not null check (collateral_amount > 0),
  borrowed_usdc_amount numeric not null check (borrowed_usdc_amount > 0),
  try_amount numeric not null check (try_amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'repaid', 'liquidated', 'defaulted')),
  created_at timestamptz not null default now(),
  due_at timestamptz
);

create table if not exists deposits (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references profiles (id) on delete cascade,
  try_amount numeric not null check (try_amount > 0),
  usdc_amount numeric,
  anchor_ref text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'converting', 'completed', 'failed')),
  supplied boolean not null default false,
  created_at timestamptz not null default now()
);

-- Migration for existing databases created before the `supplied` column existed.
alter table deposits add column if not exists supplied boolean not null default false;

alter table deposits add column if not exists supply_asset text not null default 'USDC' check (supply_asset in ('USDC', 'TRY'));

create table if not exists withdrawals (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references profiles (id) on delete cascade,
  loan_id uuid references loans (id) on delete set null,
  try_amount numeric not null check (try_amount > 0),
  usdc_amount numeric not null check (usdc_amount > 0),
  iban text not null,
  anchor_ref text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  created_at timestamptz not null default now()
);

-- A withdrawal row is the borrow intent: it is created before anything touches the
-- chain and records, server-side, every figure and destination the later steps are
-- checked against, plus the hash of each step that has already landed. Together they
-- let an interrupted cash advance be resumed instead of restarted.
alter table withdrawals add column if not exists anchor_account text;
alter table withdrawals add column if not exists anchor_memo text;
alter table withdrawals add column if not exists anchor_memo_type text;
alter table withdrawals add column if not exists collateral_asset text;
alter table withdrawals add column if not exists collateral_amount numeric;
alter table withdrawals add column if not exists collateral_tx text;
alter table withdrawals add column if not exists borrow_tx text;
alter table withdrawals add column if not exists payout_tx text;
-- Registry cache: null means "not observed on-chain", never "does not exist".
-- The chain is authoritative; these columns only speed up the UI.
alter table withdrawals add column if not exists advance_id text;     -- hex sha256 of the borrow intent
alter table withdrawals add column if not exists registry_tx text;    -- hash of the open() transaction
-- Set when the record is known to be on chain but its transaction hash is not: a retry
-- of a record that already landed fails in the contract, and the hash belongs to the first
-- attempt, which we never saw.
alter table withdrawals add column if not exists registry_recorded_at timestamptz;
alter table loans       add column if not exists registry_closed_tx text; -- hash of the mark_repaid() transaction

create table if not exists transactions_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  reference_table text not null,
  reference_id uuid not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- Security-relevant events (sign-ins, rejected transactions, money movement), kept
-- separately from transactions_log so an on-chain history view never has to filter them
-- out and so the trail survives a profile being deleted.
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  stellar_public_key text,
  action text not null,
  outcome text not null default 'ok' check (outcome in ('ok', 'rejected', 'error')),
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table audit_log enable row level security;
create index if not exists audit_log_key_idx on audit_log (stellar_public_key, created_at desc);

create index if not exists loans_borrower_id_idx on loans (borrower_id);
create index if not exists deposits_lender_id_idx on deposits (lender_id);
create index if not exists withdrawals_borrower_id_idx on withdrawals (borrower_id);
create index if not exists withdrawals_loan_id_idx on withdrawals (loan_id);
create index if not exists transactions_log_profile_id_idx on transactions_log (profile_id);

-- Row Level Security: only the service role (used by server-side API routes)
-- may read/write. The browser client never talks to these tables directly.
alter table profiles enable row level security;
alter table loans enable row level security;
alter table deposits enable row level security;
alter table withdrawals enable row level security;
alter table transactions_log enable row level security;
