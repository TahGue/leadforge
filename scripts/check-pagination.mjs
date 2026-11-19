#!/usr/bin/env node
/**
 * Quality gate G2: list endpoints page by cursor, never by offset.
 * Fails on SQL OFFSET, an `offset` query parameter, or Prisma `skip` other than
 * the `skip: 1` that steps past a cursor row.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dirs = ["apps/web/src", "apps/worker/src", "packages/pipeline/src", "packages/database/src", "packages/shared/src"];
const rules = [
  { pattern: /\bOFFSET\s+(\$|\d|\?|\{)/i, why: "SQL OFFSET" },
  { pattern: /\bskip\s*:\s*(?!1\b)[^,}\s]+/, why: "Prisma skip other than skip: 1 after a cursor" },
  { pattern: /searchParams\.get\(\s*["']offset["']\s*\)/, why: "offset query parameter" },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\./.test(name)) yield path;
  }
}

const problems = [];
let scanned = 0;
for (const dir of dirs) {
  for (const file of walk(join(root, dir))) {
    scanned += 1;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const rule of rules) {
          if (rule.pattern.test(line)) problems.push(`${relative(root, file)}:${index + 1} ${rule.why}: ${line.trim()}`);
        }
      });
  }
}

if (problems.length) {
  console.error(`offset pagination found:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`cursor pagination only (${scanned} files)`);
