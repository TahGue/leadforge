"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";
import { api } from "@/lib/client";

export interface ContactRow {
  id: string;
  email: string | null;
  phone: string | null;
  formUrl: string | null;
  name: string | null;
  jobTitle: string | null;
  category: string;
  roleBased: boolean;
  companyId: string;
  company: string;
  country: string | null;
  emailStatus: string | null;
  syntax: string | null;
  mx: string | null;
  sourceUrl: string | null;
  method: string | null;
  confidence: number;
  observedAt: string;
}

const columns: ColumnDef<ContactRow, unknown>[] = [
  {
    id: "contact",
    header: "Email / phone",
    accessorFn: (r) => r.email ?? r.phone ?? "",
    cell: ({ row }) => (
      <div className="text-xs">
        {row.original.email ? <p className="font-mono">{row.original.email}</p> : null}
        {row.original.phone ? <p className="font-mono">{row.original.phone}</p> : null}
        {row.original.formUrl ? (
          <a className="underline" href={row.original.formUrl} rel="noreferrer noopener" target="_blank">
            contact form
          </a>
        ) : null}
        {row.original.name ? <p>{row.original.name}{row.original.jobTitle ? ` · ${row.original.jobTitle}` : ""}</p> : null}
      </div>
    ),
  },
  { accessorKey: "category", header: "Category", cell: ({ row }) => <span className="badge">{row.original.category}</span> },
  {
    accessorKey: "company",
    header: "Company",
    cell: ({ row }) => (
      <Link className="hover:underline" href={`/companies/${row.original.companyId}`}>
        {row.original.company}
      </Link>
    ),
  },
  {
    id: "source",
    header: "Source",
    accessorFn: (r) => r.sourceUrl ?? "",
    cell: ({ row }) =>
      row.original.sourceUrl ? (
        <a className="block max-w-[14rem] truncate text-xs underline" href={row.original.sourceUrl} rel="noreferrer noopener" target="_blank" title={row.original.sourceUrl}>
          {row.original.sourceUrl.replace(/^https?:\/\//, "")}
        </a>
      ) : (
        <span className="muted">—</span>
      ),
  },
  { accessorKey: "syntax", header: "Syntax", cell: ({ row }) => <span className="text-xs">{row.original.syntax ?? "—"}</span> },
  { accessorKey: "mx", header: "MX", cell: ({ row }) => <span className="text-xs">{row.original.mx ?? "—"}</span> },
  { accessorKey: "emailStatus", header: "Status", cell: ({ row }) => <span className="badge">{row.original.emailStatus ?? "—"}</span> },
  { accessorKey: "confidence", header: "Confidence", cell: ({ row }) => <span className="text-xs tabular-nums">{Math.round(row.original.confidence * 100)}%</span> },
  { accessorKey: "observedAt", header: "Last observed", cell: ({ row }) => <span className="text-xs muted">{row.original.observedAt.slice(0, 10)}</span> },
];

export function ContactsTable({ rows }: { rows: ContactRow[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  async function bulk(ids: string[], action: "verify" | "suppress", clear: () => void) {
    if (action === "suppress" && !window.confirm(`Suppress ${ids.length} contact(s)? Suppressed addresses are never re-imported or contacted.`)) return;
    let ok = 0;
    for (const id of ids) {
      try {
        await api(`/api/v1/contacts/${id}/${action}`, { body: {} });
        ok += 1;
      } catch {
        // continue with the rest
      }
    }
    setMessage(`${action === "verify" ? "Verified" : "Suppressed"} ${ok}`);
    clear();
    router.refresh();
  }

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      selectable
      empty="No contacts match these filters."
      bulkActions={(ids, clear) => (
        <span className="flex items-center gap-2">
          <button type="button" className="btn text-xs" onClick={() => bulk(ids, "verify", clear)}>
            Verify (syntax + MX)
          </button>
          <button type="button" className="btn text-xs" style={{ color: "#a12b1f" }} onClick={() => bulk(ids, "suppress", clear)}>
            Suppress
          </button>
          {message ? <span className="muted">{message}</span> : null}
        </span>
      )}
    />
  );
}
