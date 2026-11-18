#!/usr/bin/env node
/**
 * Applies packages/database/sql/0002_rls.sql.
 *
 * Opt-in: only meaningful when the app connects as a non-owner role and sets
 * app.organization_id per transaction (ENABLE_RLS=true).
 *
 * Usage: node scripts/enable-rls.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = readFileSync("packages/database/sql/0002_rls.sql", "utf8");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log("row level security enabled for organization-scoped tables");
} catch (error) {
  console.error("failed to enable RLS:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
