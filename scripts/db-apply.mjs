#!/usr/bin/env node
// Applies the database schema: supabase/schema.sql first, then every file in
// supabase/migrations/ in filename order. Every statement is written to be idempotent
// (`create ... if not exists`, `add column if not exists`), so running this against a
// database that is already up to date is a no-op — which is what makes it safe to run
// from CI or a deploy step without tracking which migrations have been applied.
//
//   DATABASE_URL=postgres://... node scripts/db-apply.mjs [--dry-run]
//
// Needs `psql` on PATH. Supabase gives the connection string under
// Project Settings → Database → Connection string → URI.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
const dryRun = process.argv.includes("--dry-run");

const files = [
  join(root, "supabase", "schema.sql"),
  ...(existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => join(migrationsDir, f))
    : []),
];

const sql = files.map((file) => `-- >>> ${file}\n${readFileSync(file, "utf8")}`).join("\n\n");

if (dryRun) {
  console.log(sql);
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Pass your Supabase connection string, or use --dry-run to print the SQL.");
  process.exit(1);
}

console.error(`Applying ${files.length} file(s) to the database…`);
const result = spawnSync("psql", [url, "--variable=ON_ERROR_STOP=1", "--quiet", "--file=-"], {
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
});

if (result.error) {
  console.error(`Could not run psql: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
