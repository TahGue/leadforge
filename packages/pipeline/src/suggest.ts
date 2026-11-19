/**
 * Keyword → industry and search-keyword suggestions for the project wizard.
 *
 * The user types what they are looking for ("rörmokare", "solar panel installers").
 * The current taxonomy is always matched deterministically (aliases, as in
 * classify()). When local AI is enabled (OLLAMA_ENABLED), the model also picks
 * taxonomy codes and proposes include/exclude keywords; its answer is validated
 * against the taxonomy and cleaned before anything reaches the user. These are
 * suggestions only: nothing is saved until the user applies them to a project.
 */
import { Prisma, prisma } from "@leadforge/database";
import { normalizeName } from "@leadforge/shared";
import { classify, loadTaxonomy } from "./taxonomy";

type Db = Prisma.TransactionClient | typeof prisma;

export interface SuggestedIndustry {
  industryId: string;
  code: string;
  name: string;
  confidence: number;
  reason: string;
}

export interface KeywordSuggestion {
  query: string;
  method: "AI" | "TAXONOMY";
  industries: SuggestedIndustry[];
  includeKeywords: string[];
  excludeKeywords: string[];
  /** Why the AI was not used, when it was enabled but failed. */
  aiError?: string;
}

export interface AiSettings {
  enabled: boolean;
  url: string;
  model: string;
  timeoutMs: number;
}

export function aiSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): AiSettings {
  return {
    enabled: env.OLLAMA_ENABLED === "true",
    url: (env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, ""),
    model: env.OLLAMA_CLASSIFICATION_MODEL ?? "qwen3.8:27b",
    // The first call loads the model, which can take a while on CPU.
    timeoutMs: Number(env.OLLAMA_SUGGEST_TIMEOUT_MS ?? 120_000),
  };
}

const MAX_INDUSTRIES = 3;
const MAX_INCLUDE = 10;
const MAX_EXCLUDE = 8;
/** AI picks are never presented as more certain than a source-supplied code. */
const AI_MAX_CONFIDENCE = 0.85;
/** Words that describe any business; useless (or misleading) as industry evidence or as a keyword on their own. */
const GENERIC_WORDS = new Set([
  "company", "companies", "business", "businesses", "firm", "firms", "producer", "producers", "production",
  "product", "products", "manufacturer", "manufacturers", "maker", "makers", "supplier", "suppliers",
  "service", "services", "provider", "providers", "industry", "industries", "agency", "agencies", "foretag", "företag",
]);

/** Lowercase, trim, drop junk and duplicates; keep short search phrases only. */
export function cleanKeywords(values: unknown, max: number, drop: Iterable<string> = []): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set([...drop].map((d) => d.toLowerCase()));
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const keyword = value.toLowerCase().replace(/\s+/g, " ").replace(/^[\s"'.,;:-]+|[\s"'.,;:-]+$/g, "");
    if (keyword.length < 2 || keyword.length > 60 || keyword.split(" ").length > 4) continue;
    if (/[<>{}\[\]\\]|https?:/.test(keyword) || seen.has(keyword) || GENERIC_WORDS.has(keyword)) continue;
    seen.add(keyword);
    out.push(keyword);
    if (out.length >= max) break;
  }
  return out;
}

interface TaxonomyEntry {
  id: string;
  code: string;
  name: string;
  parent: string | null;
  aliases: string[];
}

async function taxonomyEntries(db: Db): Promise<TaxonomyEntry[]> {
  const index = await loadTaxonomy(db);
  const ids = [...index.byId.keys()];
  const aliases = await db.industryAlias.findMany({ where: { industryId: { in: ids } }, select: { industryId: true, alias: true } });
  return [...index.byId.values()].map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    parent: i.parentId ? (index.byId.get(i.parentId)?.name ?? null) : null,
    aliases: aliases.filter((a) => a.industryId === i.id && a.alias !== i.name).map((a) => a.alias),
  }));
}

/** Readable aliases of the given industries, as include-keyword suggestions. */
async function aliasKeywords(db: Db, industryIds: string[]): Promise<string[]> {
  if (!industryIds.length) return [];
  const aliases = await db.industryAlias.findMany({
    where: { industryId: { in: industryIds } },
    select: { industryId: true, alias: true },
    orderBy: { alias: "asc" },
  });
  // Keep the order of the industries (best first).
  return industryIds.flatMap((id) => aliases.filter((a) => a.industryId === id).map((a) => a.alias));
}

/** Deterministic suggestion from taxonomy aliases. */
async function taxonomySuggestion(query: string, db: Db): Promise<KeywordSuggestion> {
  const index = await loadTaxonomy(db);
  let matches = await classify({ label: query, text: query }, db);
  if (!matches.length) {
    // Loose fallback: a query word that starts an alias word ("plumb" → "plumbing").
    const words = normalizeName(query).split(" ").filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
    const hits = new Map<string, string>();
    for (const alias of index.aliases) {
      const aliasWords = alias.normalized.split(" ");
      const word = words.find((w) => aliasWords.some((a) => a.startsWith(w.slice(0, Math.max(4, w.length - 2)))));
      if (word && !hits.has(alias.industryId)) hits.set(alias.industryId, alias.normalized);
    }
    matches = [...hits].map(([industryId, alias]) => ({
      industryId,
      code: index.byId.get(industryId)!.code,
      confidence: 0.35,
      method: "KEYWORD" as const,
      evidence: `similar to "${alias}"`,
    }));
  }
  const top = matches.slice(0, MAX_INDUSTRIES);
  const industries = top.map((m) => ({
    industryId: m.industryId,
    code: m.code,
    name: index.byId.get(m.industryId)!.name,
    confidence: m.confidence,
    reason: m.method === "ALIAS" ? `matches the taxonomy name "${query}"` : `taxonomy ${m.evidence}`,
  }));
  const names = industries.map((i) => i.name);
  return {
    query,
    method: "TAXONOMY",
    industries,
    includeKeywords: cleanKeywords([query, ...(await aliasKeywords(db, top.map((m) => m.industryId)))], MAX_INCLUDE, names),
    excludeKeywords: [],
  };
}

const SYSTEM_PROMPT = `You help a B2B company-discovery tool. The user gives a keyword describing the companies they want to find.
Return JSON only, shaped exactly like:
{"industries":[{"code":"<taxonomy code>","confidence":0.0,"reason":"<short>"}],"include":["..."],"exclude":["..."]}
Rules:
- industries: 1 to 3 codes, best first, chosen ONLY from the taxonomy list. Prefer the most specific code whose description and examples fit what these companies actually do (make, grow, sell or provide). confidence is 0 to 1.
- include: 3 to 10 short words or phrases (1-3 words) that appear on the websites of the wanted companies: services, products, trade names, synonyms. Avoid generic words such as "producer", "company" or "services" on their own. Use the keyword's language; if it is not English, add English equivalents too. Only real words such companies use; never invent translations.
- exclude: 0 to 8 short words that identify look-alike businesses the user most likely does NOT want (for example retail shops vs. manufacturers, schools and courses, job boards, directories, hobby clubs). Never exclude a word that wanted companies would also use.
- No explanations outside the JSON.`;

/** Ask the local model. Throws on transport errors or unusable output. */
export async function aiSuggestion(
  query: string,
  settings: AiSettings,
  db: Db = prisma,
  fetchImpl: typeof fetch = fetch,
): Promise<KeywordSuggestion> {
  const entries = await taxonomyEntries(db);
  const taxonomyList = entries
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((e) => `${e.code} | ${e.name}${e.parent ? ` (in ${e.parent})` : ""}${e.aliases.length ? ` | e.g. ${e.aliases.slice(0, 6).join(", ")}` : ""}`)
    .join("\n");
  const response = await fetchImpl(`${settings.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(settings.timeoutMs),
    body: JSON.stringify({
      model: settings.model,
      stream: false,
      format: "json",
      think: false,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Taxonomy (code | name):\n${taxonomyList}\n\nKeyword: ${query}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`model returned HTTP ${response.status}`);
  const content = String(((await response.json()) as { message?: { content?: string } }).message?.content ?? "");
  return parseAiAnswer(query, content, entries);
}

/** Validate the model's JSON against the taxonomy; never trust codes or keywords blindly. */
export function parseAiAnswer(query: string, content: string, entries: TaxonomyEntry[]): KeywordSuggestion {
  let answer: { industries?: unknown; include?: unknown; exclude?: unknown };
  try {
    answer = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("model did not return JSON");
  }
  const byCode = new Map(entries.map((e) => [e.code.toLowerCase(), e]));
  const industries: SuggestedIndustry[] = [];
  for (const item of Array.isArray(answer.industries) ? answer.industries : []) {
    const pick = item as { code?: unknown; confidence?: unknown; reason?: unknown };
    const entry = typeof pick.code === "string" ? byCode.get(pick.code.trim().toLowerCase()) : undefined;
    if (!entry || industries.some((i) => i.industryId === entry.id)) continue;
    const confidence = typeof pick.confidence === "number" && Number.isFinite(pick.confidence) ? pick.confidence : 0.5;
    industries.push({
      industryId: entry.id,
      code: entry.code,
      name: entry.name,
      confidence: Math.round(Math.min(AI_MAX_CONFIDENCE, Math.max(0, confidence)) * 100) / 100,
      reason: typeof pick.reason === "string" ? pick.reason.slice(0, 160) : "suggested by local AI",
    });
    if (industries.length >= MAX_INDUSTRIES) break;
  }
  if (!industries.length) throw new Error("model chose no valid taxonomy code");
  const includeKeywords = cleanKeywords([query, ...(Array.isArray(answer.include) ? answer.include : [])], MAX_INCLUDE);
  // An exclude that is also an include (or the query itself) would filter out the very companies wanted.
  const excludeKeywords = cleanKeywords(answer.exclude, MAX_EXCLUDE, [query.toLowerCase(), ...includeKeywords]);
  return { query, method: "AI", industries, includeKeywords, excludeKeywords };
}

/**
 * Suggest industries and keywords for a free-text keyword. Uses the local AI
 * when enabled and falls back to the taxonomy when it is off or fails.
 */
export async function suggestFromKeyword(
  rawQuery: string,
  options: { ai?: AiSettings; fetchImpl?: typeof fetch } = {},
  db: Db = prisma,
): Promise<KeywordSuggestion> {
  const query = rawQuery.replace(/\s+/g, " ").trim().slice(0, 120);
  const fallback = await taxonomySuggestion(query, db);
  const ai = options.ai ?? aiSettingsFromEnv();
  if (!ai.enabled || !query) return fallback;
  try {
    const suggestion = await aiSuggestion(query, ai, db, options.fetchImpl);
    // An exact taxonomy alias hit is strong evidence; keep it if the model missed it.
    for (const match of fallback.industries) {
      if (match.confidence >= 0.75 && !suggestion.industries.some((i) => i.industryId === match.industryId)) {
        suggestion.industries.push(match);
      }
    }
    return suggestion;
  } catch (error) {
    const reason = error instanceof Error ? (error.name === "TimeoutError" ? "the model timed out" : error.message) : "unknown error";
    return { ...fallback, aiError: reason };
  }
}
