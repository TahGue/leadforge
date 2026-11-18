"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SuppressionForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const response = await fetch("/api/v1/suppressions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        reason: String(form.get("reason") ?? "MANUAL"),
        source: String(form.get("source") ?? "") || undefined,
      }),
    });

    setPending(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(payload?.error?.message ?? "Could not add suppression");
      return;
    }
    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card flex flex-wrap items-end gap-2 p-4">
      <div className="min-w-64 flex-1">
        <label className="mb-1 block text-xs font-medium" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" required placeholder="person@example.com" className="input" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="reason">
          Reason
        </label>
        <select id="reason" name="reason" className="input" defaultValue="MANUAL">
          <option value="MANUAL">Manual</option>
          <option value="UNSUBSCRIBED">Unsubscribed</option>
          <option value="COMPLAINT">Complaint</option>
          <option value="HARD_BOUNCE">Hard bounce</option>
          <option value="LEGAL_OBJECTION">Legal objection</option>
        </select>
      </div>
      <div className="min-w-48 flex-1">
        <label className="mb-1 block text-xs font-medium" htmlFor="source">
          Source / note
        </label>
        <input id="source" name="source" placeholder="why" className="input" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Adding…" : "Suppress"}
      </button>
      {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
