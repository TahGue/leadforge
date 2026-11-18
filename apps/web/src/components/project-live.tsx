"use client";

/** Live project status: polls progress and offers the lifecycle actions allowed in the current state. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

interface Progress {
  project: { id: string; status: string; lastError: string | null; maxCompanies: number };
  runs: Record<string, number>;
  runDetails: { id: string; status: string; candidatesFound: number; errorMessage: string | null; policyStopReason: string | null; source: { name: string } }[];
  candidates: Record<string, number>;
  rejectReasons: Record<string, number>;
  crawls: Record<string, number>;
  companies: number;
  contacts: number;
  emails: Record<string, number>;
  pagesFetched: number;
  pagesSkipped: number;
  bytesDownloaded: number;
  policyStops: { rootUrl: string; policyStopReason: string | null; errorCode: string | null }[];
}

const ACTIONS: Record<string, { action: string; label: string; primary?: boolean; confirm?: string }[]> = {
  DRAFT: [{ action: "start", label: "Start", primary: true }],
  READY: [{ action: "start", label: "Start", primary: true }],
  COMPLETED: [{ action: "start", label: "Run again" }],
  FAILED: [{ action: "start", label: "Retry run" }],
  RUNNING: [{ action: "pause", label: "Pause" }],
  QUEUED: [{ action: "pause", label: "Pause" }],
  PAUSED: [{ action: "resume", label: "Resume", primary: true }],
};

function sum(record: Record<string, number>, keys?: string[]): number {
  return Object.entries(record)
    .filter(([key]) => !keys || keys.includes(key))
    .reduce((total, [, value]) => total + value, 0);
}

export function ProjectLive({
  projectId,
  initialStatus,
  needsApproval,
  canApprove,
}: {
  projectId: string;
  initialStatus: string;
  needsApproval: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = progress?.project.status ?? initialStatus;

  const load = useCallback(async () => {
    try {
      setProgress(await api<Progress>(`/api/v1/discovery-projects/${projectId}/progress`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    const active = ["RUNNING", "QUEUED"].includes(status);
    const timer = setInterval(load, active ? 4000 : 20000);
    return () => clearInterval(timer);
  }, [load, status]);

  async function run(action: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/discovery-projects/${projectId}/${action}`, { body: {} });
      await load();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const terminalCrawls = sum(progress?.crawls ?? {}, ["SUCCEEDED", "PARTIAL", "FAILED", "BLOCKED", "CANCELLED"]);
  const totalCrawls = sum(progress?.crawls ?? {});
  const pct = totalCrawls ? Math.round((terminalCrawls / totalCrawls) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-blue">{status}</span>
        {needsApproval && canApprove ? (
          <button type="button" className="btn" disabled={busy} onClick={() => run("approve", "Approve this high-volume project? The approval is recorded in the audit log.")}>
            Approve high-volume run
          </button>
        ) : null}
        {(ACTIONS[status] ?? []).map((a) => (
          <button key={a.action} type="button" disabled={busy} className={`btn ${a.primary ? "btn-primary" : ""}`} onClick={() => run(a.action, a.confirm)}>
            {a.label}
          </button>
        ))}
        {["DRAFT", "READY", "QUEUED", "RUNNING", "PAUSED"].includes(status) ? (
          <button type="button" className="btn" style={{ color: "#a12b1f" }} disabled={busy} onClick={() => run("cancel", "Cancel this project? Queued crawls are cancelled; discovered companies are kept.")}>
            Cancel
          </button>
        ) : null}
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>

      {progress ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-3">
            <p className="text-xs muted">Companies in project</p>
            <p className="text-xl font-semibold">{progress.companies.toLocaleString("en")}</p>
            <p className="text-xs muted">cap {progress.project.maxCompanies.toLocaleString("en")}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs muted">Source records</p>
            <p className="text-xl font-semibold">{sum(progress.candidates).toLocaleString("en")}</p>
            <p className="text-xs muted">
              {progress.candidates.CREATED ?? 0} new · {progress.candidates.MERGED ?? 0} merged · {progress.candidates.REJECTED ?? 0} rejected · {progress.candidates.PENDING ?? 0} pending
            </p>
          </div>
          <div className="card p-3">
            <p className="text-xs muted">Website crawls</p>
            <p className="text-xl font-semibold">
              {terminalCrawls}/{totalCrawls}
            </p>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-[#ececea]">
              <div className="h-full bg-[var(--lf-accent)]" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs muted">
              {progress.crawls.SUCCEEDED ?? 0} ok · {progress.crawls.PARTIAL ?? 0} partial · {progress.crawls.FAILED ?? 0} failed · {progress.crawls.BLOCKED ?? 0} blocked
            </p>
          </div>
          <div className="card p-3">
            <p className="text-xs muted">Contacts found</p>
            <p className="text-xl font-semibold">{progress.contacts.toLocaleString("en")}</p>
            <p className="text-xs muted">{progress.pagesFetched.toLocaleString("en")} pages fetched · {progress.pagesSkipped} skipped</p>
          </div>
        </div>
      ) : null}

      {progress?.runDetails.length ? (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Source run</th>
                <th>Status</th>
                <th>Records</th>
                <th>Stop reason / error</th>
              </tr>
            </thead>
            <tbody>
              {progress.runDetails.map((run) => (
                <tr key={run.id}>
                  <td>{run.source.name}</td>
                  <td>
                    <span className="badge">{run.status}</span>
                  </td>
                  <td className="tabular-nums">{run.candidatesFound}</td>
                  <td className="text-xs muted">{run.policyStopReason ?? run.errorMessage ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {progress && Object.keys(progress.rejectReasons).length ? (
        <div className="card p-3 text-xs">
          <p className="mb-1 font-medium">Why records were not added</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(progress.rejectReasons).map(([reason, count]) => (
              <li key={reason}>
                <span className="muted">{reason.replaceAll("_", " ")}</span> {count}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {progress?.policyStops.length ? (
        <div className="card p-3 text-xs">
          <p className="mb-1 font-medium">Policy stops (never retried automatically)</p>
          <ul className="space-y-0.5">
            {progress.policyStops.map((stop) => (
              <li key={stop.rootUrl}>
                <span className="font-mono">{stop.rootUrl}</span> — {stop.policyStopReason ?? stop.errorCode}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {progress?.project.lastError ? <p className="text-xs text-red-700">{progress.project.lastError}</p> : null}
    </div>
  );
}
