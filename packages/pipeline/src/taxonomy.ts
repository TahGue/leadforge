/**
 * Industry classification against the current internal taxonomy (spec sections 5.2 and 7).
 *
 * Deterministic only: external codes (NACE) first, then exact alias matches on
 * the source-supplied label, then alias phrases inside the label/description.
 * Local AI classification (services/leadforge/ai.py) adds rows with method "AI".
 */
import { Prisma, prisma } from "@leadforge/database";
import { normalizeName } from "@leadforge/shared";

type Db = Prisma.TransactionClient | typeof prisma;

export interface IndustryMatch {
  industryId: string;
  code: string;
  confidence: number;
  method: "SOURCE" | "ALIAS" | "KEYWORD";
  evidence: string;
}

interface TaxonomyIndex {
  versionId: string;
  byId: Map<string, { id: string; code: string; parentId: string | null; level: number; name: string }>;
  nace: { industryId: string; code: string }[];
  aliases: { industryId: string; normalized: string }[];
  children: Map<string, string[]>;
}

let cache: { index: TaxonomyIndex; loadedAt: number } | null = null;
const CACHE_MS = 5 * 60_000;

/** NACE Rev. 2 sections by division range. */
const NACE_SECTIONS: [string, number, number][] = [
  ["A", 1, 3], ["B", 5, 9], ["C", 10, 33], ["D", 35, 35], ["E", 36, 39], ["F", 41, 43],
  ["G", 45, 47], ["H", 49, 53], ["I", 55, 56], ["J", 58, 63], ["K", 64, 66], ["L", 68, 68],
  ["M", 69, 75], ["N", 77, 82], ["O", 84, 84], ["P", 85, 85], ["Q", 86, 88], ["R", 90, 93],
  ["S", 94, 96], ["T", 97, 98], ["U", 99, 99],
];

export function naceSection(code: string): string | null {
  const division = Number.parseInt(code.replace(/^[A-U]/, "").slice(0, 2), 10);
  if (Number.isNaN(division)) return null;
  return NACE_SECTIONS.find(([, lo, hi]) => division >= lo && division <= hi)?.[0] ?? null;
}

/** Normalize "C 41.20", "4120", "41.2" to "41.20"/"41.2" (dotted, no section letter). */
export function normalizeNaceCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/\s+/g, "");
  const section = /^[A-U]$/.test(cleaned) ? cleaned : null;
  if (section) return section;
  const digits = cleaned.replace(/^[A-U]/, "").replace(/[^0-9.]/g, "");
  if (digits.includes(".")) return digits;
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2)}`;
}

/**
 * Specificity of a taxonomy NACE code that covers the candidate code, or -1.
 * Taxonomy codes look like "C", "J62", "62.01", "58.2"; candidate codes are dotted.
 */
export function naceCoverage(taxonomyCode: string, candidate: string): number {
  const tax = taxonomyCode.toUpperCase();
  const cand = normalizeNaceCode(candidate);
  if (/^[A-U]$/.test(tax)) {
    return (/^[A-U]$/.test(cand) ? cand : naceSection(cand)) === tax ? 1 : -1;
  }
  const taxDigits = tax.replace(/^[A-U]/, "");
  if (cand === taxDigits) return 10 + taxDigits.length;
  if (cand.startsWith(taxDigits) && (cand.length === taxDigits.length || /[.\d]/.test(cand[taxDigits.length] ?? ""))) {
    // "62" covers "62.01"; "58.2" covers "58.29"
    return 2 + taxDigits.length;
  }
  return -1;
}

export async function loadTaxonomy(db: Db = prisma, force = false): Promise<TaxonomyIndex> {
  if (!force && cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.index;
  const version = await db.industryTaxonomyVersion.findFirst({
    where: { isCurrent: true },
    orderBy: { publishedAt: "desc" },
  });
  if (!version) throw new Error("No current industry taxonomy; run packages/database/prisma/reference.mjs");
  const industries = await db.industry.findMany({
    where: { versionId: version.id, isActive: true },
    select: {
      id: true,
      code: true,
      parentId: true,
      level: true,
      name: true,
      externalCodes: { where: { scheme: "NACE" }, select: { code: true } },
      aliases: { select: { normalized: true } },
    },
  });
  const index: TaxonomyIndex = {
    versionId: version.id,
    byId: new Map(),
    nace: [],
    aliases: [],
    children: new Map(),
  };
  for (const industry of industries) {
    index.byId.set(industry.id, industry);
    industry.externalCodes.forEach((c) => index.nace.push({ industryId: industry.id, code: c.code }));
    industry.aliases.forEach((a) => index.aliases.push({ industryId: industry.id, normalized: a.normalized }));
    if (industry.parentId) {
      const list = index.children.get(industry.parentId) ?? [];
      list.push(industry.id);
      index.children.set(industry.parentId, list);
    }
  }
  cache = { index, loadedAt: Date.now() };
  return index;
}

export function resetTaxonomyCache(): void {
  cache = null;
}

export function descendants(index: TaxonomyIndex, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(index.children.get(id) ?? []));
  }
  return out;
}

export function ancestors(index: TaxonomyIndex, id: string): string[] {
  const out: string[] = [];
  let current = index.byId.get(id);
  while (current?.parentId) {
    out.push(current.parentId);
    current = index.byId.get(current.parentId);
  }
  return out;
}

function containsPhrase(haystack: string, phrase: string): boolean {
  if (phrase.length < 3) return false;
  return ` ${haystack} `.includes(` ${phrase} `);
}

export async function classify(
  input: { codes?: { scheme: string; code: string }[]; label?: string | null; text?: string | null },
  db: Db = prisma,
): Promise<IndustryMatch[]> {
  const index = await loadTaxonomy(db);
  const best = new Map<string, IndustryMatch>();
  const offer = (match: IndustryMatch) => {
    const current = best.get(match.industryId);
    if (!current || current.confidence < match.confidence) best.set(match.industryId, match);
  };

  for (const code of input.codes ?? []) {
    if (!["NACE", "SNI"].includes(code.scheme.toUpperCase())) continue; // SNI 2007 = NACE Rev. 2 at 4 digits
    let top: { industryId: string; score: number } | null = null;
    for (const entry of index.nace) {
      const score = naceCoverage(entry.code, code.code);
      if (score > (top?.score ?? -1)) top = { industryId: entry.industryId, score };
    }
    if (top && top.score > 0) {
      const industry = index.byId.get(top.industryId)!;
      offer({
        industryId: top.industryId,
        code: industry.code,
        confidence: top.score >= 10 ? 0.92 : top.score > 2 ? 0.88 : 0.8,
        method: "SOURCE",
        evidence: `${code.scheme} ${code.code}`,
      });
    }
  }

  const label = input.label ? normalizeName(input.label) : "";
  if (label) {
    for (const alias of index.aliases) {
      if (alias.normalized === label) {
        offer({
          industryId: alias.industryId,
          code: index.byId.get(alias.industryId)!.code,
          confidence: 0.75,
          method: "ALIAS",
          evidence: `label "${input.label}"`,
        });
      }
    }
  }

  if (best.size === 0) {
    const text = normalizeName(`${input.label ?? ""} ${input.text ?? ""}`);
    if (text) {
      for (const alias of index.aliases) {
        if (containsPhrase(text, alias.normalized)) {
          offer({
            industryId: alias.industryId,
            code: index.byId.get(alias.industryId)!.code,
            confidence: label && containsPhrase(label, alias.normalized) ? 0.6 : 0.45,
            method: "KEYWORD",
            evidence: `phrase "${alias.normalized}"`,
          });
        }
      }
    }
  }

  // Prefer the most specific node: drop a sector when one of its subsectors matched.
  const matches = [...best.values()];
  const matchedIds = new Set(matches.map((m) => m.industryId));
  return matches
    .filter((m) => ![...(index.children.get(m.industryId) ?? [])].some((child) => matchedIds.has(child)))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

export interface IndustryScope {
  include: Set<string>;
  exclude: Set<string>;
  naceCodes: string[];
  aliasTerms: string[];
}

export async function loadIndustryScope(db: Db, projectId: string): Promise<IndustryScope> {
  const index = await loadTaxonomy(db);
  const filters = await db.discoveryIndustryFilter.findMany({ where: { projectId } });
  const expand = (f: (typeof filters)[number]) =>
    f.includeDescendants ? [...descendants(index, [f.industryId])] : [f.industryId];
  const include = new Set(filters.filter((f) => f.mode === "INCLUDE").flatMap(expand));
  const exclude = new Set(filters.filter((f) => f.mode === "EXCLUDE").flatMap(expand));
  const naceCodes = [...new Set(index.nace.filter((n) => include.has(n.industryId)).map((n) => n.code))];
  const aliasTerms = [...new Set(index.aliases.filter((a) => include.has(a.industryId)).map((a) => a.normalized))];
  return { include, exclude, naceCodes, aliasTerms };
}

/** true = allowed, false = excluded/mismatch, null = unclassified (decide by policy). */
export function industryAllowed(scope: IndustryScope, matches: IndustryMatch[]): boolean | null {
  if (matches.some((m) => scope.exclude.has(m.industryId))) return false;
  if (scope.include.size === 0) return true;
  if (matches.length === 0) return null;
  return matches.some((m) => scope.include.has(m.industryId));
}
