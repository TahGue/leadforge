/**
 * Small shadcn-style primitives (ADR-0023): Tailwind classes, no runtime theme
 * library. Server-safe (no hooks).
 */
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card overflow-hidden ${className ?? ""}`}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--lf-line)] px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: number | string; hint?: string; href?: string }) {
  const body = (
    <div className="card h-full p-4">
      <p className="text-xs font-medium uppercase tracking-wide muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{typeof value === "number" ? value.toLocaleString("en") : value}</p>
      {hint ? <p className="mt-0.5 text-xs muted">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block no-underline hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

const TONE: Record<string, string> = {
  // project / job states
  RUNNING: "badge-blue",
  QUEUED: "badge-blue",
  SUCCEEDED: "badge-green",
  COMPLETED: "badge-green",
  PARTIAL: "badge-amber",
  PAUSED: "badge-amber",
  FAILED: "badge-red",
  BLOCKED: "badge-red",
  CANCELLED: "",
  READY: "",
  DRAFT: "",
  // policy
  APPROVED: "badge-green",
  UNREVIEWED: "badge-amber",
  RESTRICTED: "badge-amber",
  DENIED: "badge-red",
  // email
  MX_VALID: "badge-green",
  DNS_VALID: "badge-green",
  SYNTAX_VALID: "badge-blue",
  DISCOVERED: "",
  DELIVERABILITY_UNKNOWN: "badge-amber",
  RISKY: "badge-amber",
  UNDELIVERABLE: "badge-red",
  SUPPRESSED: "badge-red",
  VALID: "badge-green",
  INVALID: "badge-red",
  MISSING: "badge-red",
  FALLBACK_A: "badge-amber",
  // review
  REVIEWED: "badge-green",
  NEEDS_REVIEW: "badge-amber",
  OPEN: "badge-amber",
  MERGED: "badge-green",
  DISMISSED: "",
  PENDING: "badge-amber",
  PROMOTED: "badge-green",
  REJECTED: "badge-red",
  CREATED: "badge-green",
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="muted">—</span>;
  return <span className={`badge ${TONE[status] ?? ""}`}>{status.replaceAll("_", " ")}</span>;
}

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 75 ? "bg-green-600" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums" title={`Confidence ${pct}% (explainable score, not ground truth)`}>
      <span className="inline-block h-1.5 w-10 overflow-hidden rounded bg-[#ececea]">
        <span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs">{pct}%</span>
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm muted">{children}</p>;
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-[var(--lf-line)] text-sm">
      {items.map(([key, value]) => (
        <div key={key} className="flex justify-between gap-4 px-4 py-2">
          <dt className="muted">{key}</dt>
          <dd className="min-w-0 text-right">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
