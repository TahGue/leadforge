"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SourceCreateForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const response = await fetch("/api/v1/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        sourceType: String(form.get("sourceType") ?? "WEBSITE"),
        baseUrl: String(form.get("baseUrl") ?? "") || undefined,
        tosUrl: String(form.get("tosUrl") ?? "") || undefined,
        policyNotes: String(form.get("policyNotes") ?? "") || undefined,
      }),
    });

    setPending(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(payload?.error?.message ?? "Could not create source");
      return;
    }
    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card grid gap-3 p-4 md:grid-cols-2">
      <h2 className="text-sm font-semibold md:col-span-2">Register a source</h2>
      <input name="name" required placeholder="Source name" className="input" />
      <select name="sourceType" className="input" defaultValue="WEBSITE">
        <option value="WEBSITE">Company website</option>
        <option value="DIRECTORY">Directory</option>
        <option value="SEARCH">Search results</option>
        <option value="REGISTRY">Public registry</option>
        <option value="IMPORT">User import</option>
        <option value="MANUAL">Manual entry</option>
      </select>
      <input name="baseUrl" placeholder="https://directory.example" className="input" />
      <input name="tosUrl" placeholder="Terms of use URL (required to approve)" className="input" />
      <textarea
        name="policyNotes"
        placeholder="Policy review notes"
        className="input md:col-span-2"
        rows={2}
      />
      {error ? <p className="text-sm text-red-700 md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Saving…" : "Register source"}
        </button>
      </div>
    </form>
  );
}

export function SourceApproveButton({
  sourceId,
  tosUrl,
  hasTos,
}: {
  sourceId: string;
  tosUrl: string;
  hasTos: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    const notes = window.prompt("Policy review notes (why is collection permitted?)");
    if (!notes) return;
    const terms = tosUrl || window.prompt("Terms of use URL") || "";
    if (!terms) {
      setError("A terms URL is required");
      return;
    }

    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permitted: true, policyNotes: notes, tosUrl: terms }),
    });
    setPending(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(payload?.error?.message ?? "Approval failed");
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className="btn" onClick={approve} disabled={pending}>
        {pending ? "Approving…" : hasTos ? "Approve" : "Approve…"}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
