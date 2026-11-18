#!/usr/bin/env node
/**
 * Deterministic secret scan over the working tree.
 *
 * gitleaks-action now requires a commercial licence, so the repository uses a
 * small, predictable scanner instead: it looks for credential-shaped strings
 * and fails on anything that is not an obvious placeholder. CI runs it on every
 * push, so a committed secret breaks the build.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".venv",
  ".pgdata",
  ".pnpm-store",
  ".pnpm-cache",
  ".home",
  ".uv-cache",
  ".tools",
  ".cache",
  ".npm-cache",
  "data",
  "backups",
  "coverage",
  "dist",
]);

const SKIP_FILES = new Set([".env", "pnpm-lock.yaml", "uv.lock"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // unreadable local cache directories are not part of the repo
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".git")) continue;
    if (entry.isDirectory()) {
      if (entry.name.startsWith("pytest-cache-files-")) continue;
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (!SKIP_FILES.has(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const files = walk(".").filter(
  (file) => !/\.(png|jpe?g|gif|webp|ico|pdf|gz|zst|woff2?|lock)$/i.test(file),
);

const PATTERNS = [
  { name: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "github token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "github fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: "aws access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: "openai-style key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "stripe key", re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  {
    name: "assigned credential",
    re: /\b(?:password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*["'][^"'\s]{16,}["']/i,
  },
];

const PLACEHOLDER =
  /(change[-_ ]?me|ci-|test[-_]|dev[-_]|example|placeholder|your[-_]|xxxx|replace|dummy|\$\{|process\.env|env\.|secret-|password-|minimum|generated)/i;

const findings = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of PATTERNS) {
      if (!pattern.re.test(line)) continue;
      if (PLACEHOLDER.test(line)) continue;
      findings.push({ file, line: i + 1, kind: pattern.name });
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found:");
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} (${finding.kind})`);
  }
  process.exit(1);
}

console.log(`secret scan clean (${files.length} files)`);
