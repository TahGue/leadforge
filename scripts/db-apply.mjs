#!/usr/bin/env node
/**
 * Applies SQL migrations without the Prisma schema engine.
 *
 * Used where the engine process cannot be spawned (restricted sandboxes) and
 * in CI jobs without Node. Records each migration in _prisma_migrations
 * using the same checksum Prisma computes, so a later `prisma migrate deploy`
 * sees the database as up to date instead of re-running everything.
 *
 * Usage: node scripts/db-apply.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://leadforge:leadforge_local@127.0.0.1:5432/leadforge?schema=public";

const migrationsDir = join(process.cwd(), "packages/database/prisma/migrations");
if (!existsSync(migrationsDir)) {
  console.error(`no migrations directory at ${migrationsDir}`);
  process.exit(1);
}

const dirs = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  );
`);

for (const dir of dirs) {
  const file = join(migrationsDir, dir, "migration.sql");
  if (!existsSync(file)) continue;
  const sql = readFileSync(file, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");

  const { rows } = await client.query(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND rolled_back_at IS NULL`,
    [dir],
  );
  if (rows.length > 0) {
    console.log(`skip  ${dir} (already applied)`);
    continue;
  }

  console.log(`apply ${dir}`);
  const id = crypto.randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations"
        ("id","checksum","finished_at","migration_name","applied_steps_count")
       VALUES ($1,$2,now(),$3,1)`,
      [id, checksum, dir],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`failed ${dir}: ${error.message}`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log("migrations up to date");
