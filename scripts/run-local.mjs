#!/usr/bin/env node
/**
 * One-command local run: database + migrations + web server.
 *
 * Use this on a workstation without Docker. Production uses docker compose.
 *
 *   node scripts/run-local.mjs
 *
 * Environment is defaulted for local use only; export values to override.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps", "web");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://leadforge:leadforge_local@127.0.0.1:5432/leadforge?schema=public&pgbouncer=true&connection_limit=1";

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  SESSION_SECRET: process.env.SESSION_SECRET ?? "local-run-session-secret-local-run-000000",
  UNSUBSCRIBE_SIGNING_KEY:
    process.env.UNSUBSCRIBE_SIGNING_KEY ?? "local-run-unsubscribe-key-local-run-0000",
  MAIL_POSTAL_ADDRESS:
    process.env.MAIL_POSTAL_ADDRESS ?? "LeadForge Demo, Testgatan 1, 111 22 Stockholm",
  APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  MAIL_ENABLED: process.env.MAIL_ENABLED ?? "false",
  NEXT_TELEMETRY_DISABLED: "1",
};

let db = null;
let web = null;
let stopping = false;

function waitForPort(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} did not open`));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

function run(command, args, options) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  child.on("exit", (code) => {
    if (stopping) return;
    console.error(`${command} exited with code ${code}; shutting down`);
    void shutdown(code ?? 1);
  });
  return child;
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [web, db]) {
    if (child && !child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

const isUp = await new Promise((resolve) => {
  const socket = createConnection({ host: "127.0.0.1", port: 5432 }, () => {
    socket.end();
    resolve(true);
  });
  socket.on("error", () => {
    socket.destroy();
    resolve(false);
  });
});

if (isUp) {
  console.log("database already listening on 5432");
} else {
  console.log("starting local database...");
  db = run(process.execPath, [join(root, "scripts", "dev-db.mjs"), "5432"], { cwd: root, env });
  await waitForPort(5432);
}

if (!existsSync(join(appDir, ".next", "BUILD_ID"))) {
  console.error("No production build found. Run: pnpm --filter @leadforge/web build");
  await shutdown(1);
} else {
  console.log("applying migrations...");
  const migrate = spawn(process.execPath, [join(root, "scripts", "db-apply.mjs")], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  await new Promise((resolve) => migrate.on("exit", resolve));

  console.log("starting LeadForge on http://localhost:3000");
  web = run(
    process.execPath,
    [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", "3000"],
    { cwd: appDir, env },
  );
}
