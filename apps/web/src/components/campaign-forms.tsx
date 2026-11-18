"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CampaignCreateForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const response = await fetch("/api/v1/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        subject: String(form.get("subject") ?? ""),
        bodyHtml: String(form.get("bodyHtml") ?? ""),
        bodyText: String(form.get("bodyText") ?? ""),
        lawfulBasis: String(form.get("lawfulBasis") ?? "LEGITIMATE_INTEREST"),
        segmentDefinition: {
          countryCodes: [],
          industries: [],
          contactTypes: [],
          minConfidence: 0,
          onlyMxValid: true,
        },
        jurisdictionScope: [],
      }),
    });

    setPending(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(payload?.error?.message ?? "Could not create campaign");
      return;
    }

    const payload = (await response.json()) as { data: { id: string } };
    router.push(`/campaigns/${payload.data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold">New campaign</h2>
      <div className="grid gap-2 md:grid-cols-2">
        <input name="name" required placeholder="Campaign name" className="input" />
        <input name="subject" required placeholder="Subject line" className="input" />
      </div>
      <textarea
        name="bodyHtml"
        required
        rows={4}
        placeholder="<p>Hello…</p>"
        className="input font-mono text-xs"
      />
      <textarea
        name="bodyText"
        required
        rows={3}
        placeholder="Plain text version (required)"
        className="input font-mono text-xs"
      />
      <select name="lawfulBasis" className="input" defaultValue="LEGITIMATE_INTEREST">
        <option value="LEGITIMATE_INTEREST">Legitimate interest (with LIA)</option>
        <option value="CONSENT">Consent</option>
        <option value="CONTRACT">Contract</option>
        <option value="LEGAL_OBLIGATION">Legal obligation</option>
      </select>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create campaign"}
      </button>
    </form>
  );
}
