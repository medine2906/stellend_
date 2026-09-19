# Migrations

`schema.sql` is the full, current schema and is applied first. Anything that cannot be
expressed idempotently there — a backfill, a rename, a constraint change on existing rows —
goes in a numbered file here:

```
0001_backfill_withdrawal_anchor_accounts.sql
```

Both are applied, in that order, by:

```bash
DATABASE_URL=postgres://... npm run db:apply
npm run db:apply -- --dry-run   # print the SQL instead of running it
```

Write every statement so that running it twice is harmless (`if not exists`, `where` guards).
There is no applied-migrations table; idempotency is what makes re-running safe.
