"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";
import { api } from "@/lib/client";

export interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  city: string | null;
  industries: string[];
  employeeRange: string | null;
  contacts: number;
  evidence: number;
  confidence: number;
  lastSeenAt: string;
  reviewStatus: string;
  tags: string[];
}

const columns: ColumnDef<CompanyRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Company",
    cell: ({ row }) => (
      <Link href={`/companies/${row.original.id}`} className="font-medium underline-offset-2 hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  { id: "location", header: "City / country", accessorFn: (r) => `${r.city ?? ""} ${r.country ?? ""}`, cell: ({ row }) => <span className="text-xs">{[row.original.city, row.original.country].filter(Boolean).join(", ") || "—"}</span> },
  { id: "industry", header: "Industry", accessorFn: (r) => r.industries[0] ?? "", cell: ({ row }) => <span className="text-xs">{row.original.industries.join("; ") || "unclassified"}</span> },
  { accessorKey: "domain", header: "Website", cell: ({ row }) => (row.original.domain ? <span className="font-mono text-xs">{row.original.domain}</span> : <span className="muted">—</span>) },
  { accessorKey: "employeeRange", header: "Size", cell: ({ row }) => <span className="text-xs">{row.original.employeeRange ?? "—"}</span> },
  { accessorKey: "contacts", header: "Contacts" },
  { accessorKey: "evidence", header: "Evidence" },
  {
    accessorKey: "confidence",
    header: "Confidence",
    cell: ({ row }) => <span className="tabular-nums text-xs">{Math.round(row.original.confidence * 100)}%</span>,
  },
  { accessorKey: "lastSeenAt", header: "Last observed", cell: ({ row }) => <span className="text-xs muted">{row.original.lastSeenAt.slice(0, 10)}</span> },
  { accessorKey: "reviewStatus", header: "Review", cell: ({ row }) => <span className="badge">{row.original.reviewStatus.replace("_", " ")}</span> },
  { id: "tags", header: "Tags", accessorFn: (r) => r.tags.join(","), cell: ({ row }) => <span className="text-xs">{row.original.tags.join(", ")}</span> },
];

export function CompaniesTable({ rows }: { rows: CompanyRow[] }) {
  const router = useRouter();
  const [tag, setTag] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function applyTag(ids: string[], mode: "add" | "remove", clear: () => void) {
    if (!tag.trim()) return setMessage("Enter a tag");
    try {
      await api("/api/v1/companies/tags", { body: { ids, [mode]: [tag.trim()] } });
      setMessage(`${mode === "add" ? "Tagged" : "Untagged"} ${ids.length}`);
      clear();
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function crawl(ids: string[], clear: () => void) {
    let ok = 0;
    for (const id of ids) {
      try {
        await api(`/api/v1/companies/${id}/crawl`, { body: {} });
        ok += 1;
      } catch {
        // companies without a domain are skipped
      }
    }
    setMessage(`Queued ${ok} crawl(s)`);
    clear();
  }

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      selectable
      empty="No companies match these filters."
      bulkActions={(ids, clear) => (
        <span className="flex flex-wrap items-center gap-2">
          <input className="input w-36 py-1 text-xs" placeholder="tag (e.g. customer)" value={tag} onChange={(e) => setTag(e.target.value)} />
          <button type="button" className="btn text-xs" onClick={() => applyTag(ids, "add", clear)}>
            Add tag
          </button>
          <button type="button" className="btn text-xs" onClick={() => applyTag(ids, "remove", clear)}>
            Remove tag
          </button>
          <button type="button" className="btn text-xs" onClick={() => crawl(ids, clear)}>
            Crawl now
          </button>
          {message ? <span className="muted">{message}</span> : null}
        </span>
      )}
    />
  );
}
