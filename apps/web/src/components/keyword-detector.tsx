"use client";

/**
 * "Detect from keyword": the user types what they are looking for, the server
 * (local AI when enabled, the taxonomy otherwise) suggests industries and
 * include/exclude keywords, and the user removes what they don't want before
 * applying. Nothing is saved until the project itself is saved.
 */
import { useState } from "react";
import { api } from "@/lib/client";

export interface KeywordSuggestion {
  query: string;
  method: "AI" | "TAXONOMY";
  industries: { industryId: string; code: string; name: string; confidence: number; reason: string }[];
  includeKeywords: string[];
  excludeKeywords: string[];
  aiError?: string;
}

export function KeywordDetector({ onApply }: { onApply: (suggestion: KeywordSuggestion) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<KeywordSuggestion | null>(null);

  async function detect() {
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setSuggestion(await api<KeywordSuggestion>("/api/v1/industries/suggest", { body: { query: query.trim() } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const drop = (field: "includeKeywords" | "excludeKeywords", keyword: string) =>
    suggestion && setSuggestion({ ...suggestion, [field]: suggestion[field].filter((k) => k !== keyword) });
  const dropIndustry = (id: string) =>
    suggestion && setSuggestion({ ...suggestion, industries: suggestion.industries.filter((i) => i.industryId !== id) });

  return (
    <div className="card space-y-3 p-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void detect();
        }}
      >
        <label className="min-w-[220px] flex-1 text-xs">
          <span className="muted">Detect from a keyword (e.g. “olive oil producer”, “rörmokare”)</span>
          <input className="input mt-1" value={query} maxLength={120} onChange={(e) => setQuery(e.target.value)} placeholder="What kind of companies are you looking for?" />
        </label>
        <button type="submit" className="btn" disabled={busy || query.trim().length < 2}>
          {busy ? "Detecting…" : "Detect industry"}
        </button>
      </form>
      {busy ? <p className="muted text-xs">The local AI model can take up to a minute on the first request.</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {suggestion ? (
        <div className="space-y-2 text-xs">
          <p className="muted">
            {suggestion.method === "AI" ? "Suggested by the local AI model" : "Matched against the industry taxonomy"}
            {suggestion.aiError ? ` (AI unavailable: ${suggestion.aiError})` : ""}. Click × to drop anything before applying.
          </p>
          <ChipRow label="Industries" empty="No matching industry. Try another word, or pick one below.">
            {suggestion.industries.map((i) => (
              <Chip key={i.industryId} title={i.reason} onRemove={() => dropIndustry(i.industryId)}>
                {i.name} · {Math.round(i.confidence * 100)}%
              </Chip>
            ))}
          </ChipRow>
          <ChipRow label="Include keywords" empty="None">
            {suggestion.includeKeywords.map((k) => (
              <Chip key={k} onRemove={() => drop("includeKeywords", k)}>{k}</Chip>
            ))}
          </ChipRow>
          <ChipRow label="Exclude keywords" empty={suggestion.method === "AI" ? "None" : "Exclude suggestions need the local AI (OLLAMA_ENABLED)."}>
            {suggestion.excludeKeywords.map((k) => (
              <Chip key={k} tone="exclude" onRemove={() => drop("excludeKeywords", k)}>−{k}</Chip>
            ))}
          </ChipRow>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={() => { onApply(suggestion); setSuggestion(null); }}>
              Apply to project
            </button>
            <button type="button" className="btn" onClick={() => setSuggestion(null)}>Discard</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChipRow({ label, empty, children }: { label: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <p className="muted mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">{children.length ? children : <span className="muted">{empty}</span>}</div>
    </div>
  );
}

function Chip({ children, onRemove, title, tone }: { children: React.ReactNode; onRemove: () => void; title?: string; tone?: "exclude" }) {
  return (
    <span title={title} className={`badge inline-flex items-center gap-1 ${tone === "exclude" ? "badge-red" : ""}`}>
      {children}
      <button type="button" aria-label="Remove" className="opacity-60 hover:opacity-100" onClick={onRemove}>×</button>
    </span>
  );
}
