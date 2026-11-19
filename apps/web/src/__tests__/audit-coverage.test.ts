/**
 * Quality gate G2: every mutating API route writes an audit row.
 * Exemptions are explicit and explained, so a new route cannot skip auditing silently.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const API = join(__dirname, "..", "app", "api");
const MUTATING = /export (?:const|async function|function) (?:POST|PATCH|PUT|DELETE)\b/;

const EXEMPT: Record<string, string> = {
  // Read-only computation exposed as POST because the body is a full project draft.
  "v1/discovery-projects/[id]/preview/route.ts": "read-only preview",
  // Writes an append-only, versioned EligibilityDecision row, which is its own audit trail (Phase 9, frozen).
  "v1/eligibility/evaluate/route.ts": "append-only decision record",
  // Public, token-authenticated; records a suppression with its source instead of an actor.
  "v1/unsubscribe/[token]/route.ts": "suppression record carries the provenance",
  // MTA webhook (shared key, no user or organization): writes an append-only EmailEvent and a global suppression tagged bounce_ingest.
  "v1/events/bounce/route.ts": "append-only EmailEvent and tagged global suppression",
};

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routes(path) : name === "route.ts" ? [path] : [];
  });
}

describe("audit coverage", () => {
  it("audits every mutating route (or exempts it with a reason)", () => {
    const missing = routes(API)
      .map((file) => ({ file, rel: relative(API, file).replaceAll("\\", "/"), source: readFileSync(file, "utf8") }))
      .filter(({ source }) => MUTATING.test(source))
      .filter(({ rel, source }) => !EXEMPT[rel] && !/\baudit\(|auditLog\.create/.test(source))
      .map(({ rel }) => rel);
    expect(missing).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    for (const rel of Object.keys(EXEMPT)) {
      const source = readFileSync(join(API, rel), "utf8");
      expect(MUTATING.test(source)).toBe(true);
    }
  });
});
