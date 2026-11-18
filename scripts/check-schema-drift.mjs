#!/usr/bin/env node
/**
 * Fails when the Prisma schema and the applied migrations disagree (spec 29:
 * every schema change needs a migration). Run after `prisma migrate deploy`.
 *
 * Generated PostGIS/FTS columns are declared as Unsupported(...) in Prisma and
 * created with GENERATED ALWAYS in SQL; Prisma reads them as columns with a
 * default and proposes "DROP DEFAULT". Those lines are expected and ignored.
 *
 *   node scripts/check-schema-drift.mjs
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [
    join(root, "node_modules/prisma/build/index.js"),
    "migrate",
    "diff",
    "--from-url",
    url,
    "--to-schema-datamodel",
    join(root, "packages/database/prisma/schema.prisma"),
    "--script",
  ],
  { encoding: "utf8" },
);
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

const GENERATED = /ALTER TABLE "(City|CompanyLocation|DiscoveryLocation)" ALTER COLUMN "geog" DROP DEFAULT;|ALTER TABLE "Company" ALTER COLUMN "searchVector" DROP DEFAULT;/;
const drift = result.stdout
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("--") && !GENERATED.test(line) && line !== "-- This is an empty migration.");

if (drift.length) {
  console.error("Schema drift: the Prisma schema has changes without a migration:\n");
  console.error(drift.join("\n"));
  console.error("\nGenerate one with: prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel ... --script");
  process.exit(1);
}
console.log("schema matches migrations");
