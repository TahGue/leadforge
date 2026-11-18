#!/usr/bin/env node
/**
 * Local PostgreSQL-compatible server for environments without Docker.
 *
 * Runs PGlite (Postgres compiled to WASM) and exposes it over the Postgres
 * wire protocol on 127.0.0.1:5432, so Prisma and the Python workers connect
 * exactly as they would to a real server.
 *
 * This is a development convenience only. Production uses the postgres
 * container in docker-compose.yml.
 *
 * Usage: node scripts/dev-db.mjs [port]
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const port = Number(process.argv[2] ?? 5432);
const dataDir = join(process.cwd(), ".pgdata");
mkdirSync(dataDir, { recursive: true });

const db = await PGlite.create({ dataDir });
const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port });

await server.start();
console.log(`leadforge dev db listening on 127.0.0.1:${port} (data: ${dataDir})`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log("\nstopping dev db...");
  try {
    await server.stop();
  } finally {
    await db.close();
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
