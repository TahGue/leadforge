"use client";

/** Sector/subsector picker (spec 5.2). Each node cycles: not selected -> include -> exclude. */
import { useState } from "react";

export interface IndustryNode {
  id: string;
  code: string;
  name: string;
  externalCodes?: { scheme: string; code: string }[];
  children?: IndustryNode[];
}

export type IndustryFilterValue = {
  industryId: string;
  mode: "INCLUDE" | "EXCLUDE";
  isPrimary: boolean;
  includeDescendants: boolean;
};

export function IndustryPicker({
  tree,
  value,
  onChange,
}: {
  tree: IndustryNode[];
  value: IndustryFilterValue[];
  onChange: (next: IndustryFilterValue[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");

  const modeOf = (id: string) => value.find((v) => v.industryId === id)?.mode ?? null;

  function cycle(id: string) {
    const current = modeOf(id);
    const rest = value.filter((v) => v.industryId !== id);
    if (current === null) onChange([...rest, { industryId: id, mode: "INCLUDE", isPrimary: false, includeDescendants: true }]);
    else if (current === "INCLUDE") onChange([...rest, { industryId: id, mode: "EXCLUDE", isPrimary: false, includeDescendants: true }]);
    else onChange(rest);
  }

  const term = filter.trim().toLowerCase();
  const matches = (node: IndustryNode): boolean =>
    !term || node.name.toLowerCase().includes(term) || (node.children ?? []).some(matches);

  const pill = (id: string) => {
    const mode = modeOf(id);
    return (
      <button
        type="button"
        onClick={() => cycle(id)}
        className={`badge ${mode === "INCLUDE" ? "badge-green" : mode === "EXCLUDE" ? "badge-red" : ""}`}
        title="Click to include, again to exclude, again to clear"
      >
        {mode === "INCLUDE" ? "include" : mode === "EXCLUDE" ? "exclude" : "—"}
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <input className="input" placeholder="Filter sectors…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ul className="max-h-96 space-y-1 overflow-y-auto pr-1 text-sm">
        {tree.filter(matches).map((sector) => (
          <li key={sector.id} className="rounded border border-[var(--lf-line)] bg-white">
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <button type="button" className="flex-1 text-left font-medium" onClick={() => setOpen({ ...open, [sector.id]: !open[sector.id] })}>
                {open[sector.id] || term ? "▾" : "▸"} {sector.name}
                <span className="ml-2 text-xs muted">{(sector.externalCodes ?? []).map((c) => c.code).join(", ")}</span>
              </button>
              {pill(sector.id)}
            </div>
            {open[sector.id] || term ? (
              <ul className="border-t border-[var(--lf-line)] py-1">
                {(sector.children ?? []).filter(matches).map((sub) => (
                  <li key={sub.id} className="flex items-center justify-between gap-2 px-6 py-1">
                    <span>
                      {sub.name}
                      <span className="ml-2 text-xs muted">NACE {(sub.externalCodes ?? []).map((c) => c.code).join(", ")}</span>
                    </span>
                    {pill(sub.id)}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-xs muted">
        Including a sector includes all its subsectors. A company may belong to several industries; classification
        method and confidence are kept per assignment.
      </p>
    </div>
  );
}
