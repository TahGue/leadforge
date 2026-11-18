"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApiKeyForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const name = window.prompt("Key name (e.g. n8n integration)");
    if (!name) return;

    setPending(true);
    setError(null);
    const response = await fetch("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setPending(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(payload?.error?.message ?? "Could not create key");
      return;
    }

    const payload = (await response.json()) as { data: { key: string } };
    setCreated(payload.data.key);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button type="button" className="btn" onClick={create} disabled={pending}>
        {pending ? "Creating…" : "Create API key"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {created ? (
        <div className="rounded-md bg-amber-50 p-2 text-xs">
          <p className="font-medium">Copy this key now — it is shown once.</p>
          <code className="mt-1 block break-all font-mono">{created}</code>
        </div>
      ) : null}
    </div>
  );
}
