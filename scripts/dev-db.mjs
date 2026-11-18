#!/usr/bin/env node
/**
 * Local PostgreSQL for workstations without Docker.
 *
 * Runs real PostgreSQL binaries (via embedded-postgres) on 127.0.0.1:5432 with
 * the database and role the app expects. Unlike a WASM shim, this supports
 * prepared statements and long-lived Prisma connections, so the app behaves the
 * same as it does against the production container.
 *
 * Production uses the postgres service in docker-compose.yml.
 *
 * Usage: node scripts/dev-db.mjs [port]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const port = Number(process.argv[2] ?? 5432);
const databaseDir = join(process.cwd(), ".pgdata");
const user = process.env.POSTGRES_USER ?? "leadforge";
const password = process.env.POSTGRES_PASSWORD ?? "leadforge_local";
const database = process.env.POSTGRES_DB ?? "leadforge";

const fresh = !existsSync(join(databaseDir, "PG_VERSION"));

const instance = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
});

if (fresh) {
  console.log(`initialising PostgreSQL cluster in ${databaseDir}`);
  await instance.initialise();
}

await instance.start();

try {
  await instance.createDatabase(database);
  console.log(`created database ${database}`);
} catch (error) {
  if (!/already exists/i.test(String(error?.message ?? error))) throw error;
}

// Prove the app's connection string works before declaring readiness.
const client = new pg.Client({
  host: "127.0.0.1",
  port,
  user,
  password,
  database,
});
await client.connect();
const { rows } = await client.query("select version()");
await client.end();

console.log(`leadforge dev db ready on 127.0.0.1:${port}`);
console.log(`  ${rows[0].version.split(",")[0]}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\nstopping dev db...");
  try {
    await instance.stop();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
