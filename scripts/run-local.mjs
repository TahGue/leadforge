#!/usr/bin/env node
/**
 * One-command local development: PostGIS + Redis (Docker), migrations,
 * reference data, demo seed, then the web app and orchestration worker.
 *
 *   node scripts/run-local.mjs            # or: pnpm local
 *
 * Ports default to 5432/6379; set DEV_PG_PORT / DEV_REDIS_PORT if those are taken.
 * Start the Python crawler separately:  python -m leadforge.worker
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pgPort = process.env.DEV_PG_PORT ?? "5432";
const redisPort = process.env.DEV_REDIS_PORT ?? "6379";
const password = process.env.POSTGRES_PASSWORD ?? "leadforge_local";

const env = {
  ...process.env,
  POSTGRES_PASSWORD: password,
  SESSION_SECRET: process.env.SESSION_SECRET ?? "local-run-session-secret-local-run-000000",
  DEV_PG_PORT: pgPort,
  DEV_REDIS_PORT: redisPort,
  DATABASE_URL: process.env.DATABASE_URL ?? `postgresql://leadforge:${password}@127.0.0.1:${pgPort}/leadforge?schema=public`,
  REDIS_URL: process.env.REDIS_URL ?? `redis://127.0.0.1:${redisPort}/0`,
  APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  NEXT_TELEMETRY_DISABLED: "1",
};

function step(label, command, args, options = {}) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32", ...options });
  if (result.status !== 0) {
    console.error(`${label} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

step("start PostGIS and Redis", "docker", [
  "compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml", "up", "-d", "--wait", "postgres", "redis",
]);
step("apply migrations", process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "packages/database/prisma/schema.prisma"]);
step("load reference data", process.execPath, ["packages/database/prisma/reference.mjs"]);
step("seed demo organization", process.execPath, ["packages/database/prisma/seed.mjs"]);

const children = [
  spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-p", "3000"], { cwd: join(root, "apps/web"), env, stdio: "inherit" }),
  spawn(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), "apps/worker/src/index.ts"], { cwd: root, env, stdio: "inherit" }),
];
console.log("\nLeadForge on http://localhost:3000 (admin@leadforge.local / ChangeMe123! — change it)");

const stop = () => {
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => code && stop());
