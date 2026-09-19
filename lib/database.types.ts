// Hand-written types mirroring supabase/schema.sql, following the same shape
// `supabase gen types typescript` produces. If the schema changes,
// regenerate against the real project and keep this file in sync.

export type LoanStatus = "pending" | "active" | "repaid" | "liquidated" | "defaulted";
export type DepositStatus = "pending" | "converting" | "completed" | "failed";
export type WithdrawalStatus = "pending" | "processing" | "completed" | "failed";

export type ProfileRow = {
  id: string;
  stellar_public_key: string;
  created_at: string;
  sandbox_iban: string | null;
  sandbox_holder: string | null;
  sandbox_created_at: string | null;
};

export type LoanRow = {
  id: string;
  borrower_id: string;
  collateral_asset: string;
  collateral_amount: number;
  borrowed_usdc_amount: number;
  try_amount: number;
  status: LoanStatus;
  created_at: string;
  due_at: string | null;
  /** Hash of the mark_repaid() transaction, if the borrower has called it. Null = not yet closed on-chain. */
  registry_closed_tx: string | null;
};

export type DepositRow = {
  id: string;
  lender_id: string;
  try_amount: number;
  usdc_amount: number | null;
  anchor_ref: string;
  status: DepositStatus;
  supplied: boolean;
  /** Asset the lender chose to supply; TRY positions are displayed in TRY, USDC positions in USDC. */
  supply_asset?: "USDC" | "TRY";
  created_at: string;
};

export type WithdrawalRow = {
  id: string;
  borrower_id: string;
  loan_id: string | null;
  try_amount: number;
  usdc_amount: number;
  iban: string;
  anchor_ref: string;
  status: WithdrawalStatus;
  created_at: string;
  /** Where the anchor wants the borrowed USDC sent; captured when the withdrawal is reserved. */
  anchor_account: string | null;
  anchor_memo: string | null;
  anchor_memo_type: string | null;
  /** Collateral the borrower actually locked, decoded from their signed transaction. */
  collateral_asset: string | null;
  collateral_amount: number | null;
  /** Hash of each step that has landed on-chain, so an interrupted advance can resume. */
  collateral_tx: string | null;
  borrow_tx: string | null;
  payout_tx: string | null;
  /** Registry cache — null means not yet observed on-chain, never "does not exist".
   *  advance_id is the hex sha256 used as the on-chain key.
   *  registry_tx is the hash of the open() transaction. */
  advance_id: string | null;
  registry_tx: string | null;
};

export type SandboxSpendRow = {
  id: string;
  profile_id: string;
  amount: number;
  description: string;
  created_at: string;
};

export type AuditLogRow = {
  id: string;
  stellar_public_key: string | null;
  action: string;
  outcome: "ok" | "rejected" | "error";
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type TransactionsLogRow = {
  id: string;
  profile_id: string;
  kind: string;
  reference_table: string;
  reference_id: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & Pick<ProfileRow, "stellar_public_key">;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      loans: {
        Row: LoanRow;
        Insert: Partial<LoanRow> &
          Pick<LoanRow, "borrower_id" | "collateral_asset" | "collateral_amount" | "borrowed_usdc_amount" | "try_amount">;
        Update: Partial<LoanRow>;
        Relationships: [];
      };
      deposits: {
        Row: DepositRow;
        Insert: Partial<DepositRow> & Pick<DepositRow, "lender_id" | "try_amount" | "anchor_ref">;
        Update: Partial<DepositRow>;
        Relationships: [];
      };
      withdrawals: {
        Row: WithdrawalRow;
        Insert: Partial<WithdrawalRow> &
          Pick<WithdrawalRow, "borrower_id" | "try_amount" | "usdc_amount" | "iban" | "anchor_ref">;
        Update: Partial<WithdrawalRow>;
        Relationships: [];
      };
      audit_log: {
        Row: AuditLogRow;
        Insert: Partial<AuditLogRow> & Pick<AuditLogRow, "action">;
        Update: Partial<AuditLogRow>;
        Relationships: [];
      };
      transactions_log: {
        Row: TransactionsLogRow;
        Insert: Partial<TransactionsLogRow> &
          Pick<TransactionsLogRow, "profile_id" | "kind" | "reference_table" | "reference_id">;
        Update: Partial<TransactionsLogRow>;
        Relationships: [];
      };
      sandbox_spends: {
        Row: SandboxSpendRow;
        Insert: Partial<SandboxSpendRow> & Pick<SandboxSpendRow, "profile_id" | "amount">;
        Update: Partial<SandboxSpendRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
