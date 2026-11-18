"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function useSubmit(url: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(body: unknown): Promise<boolean> {
    setPending(true);
    setError(null);
    setDone(null);
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    setPending(false);

    if (!response.ok) {
      setError(payload?.error?.message ?? "Request failed");
      return false;
    }
    setDone("Saved");
    router.refresh();
    return true;
  }

  return { submit, pending, error, done };
}

export function CompanyCreateForm() {
  const { submit, pending, error, done } = useSubmit("/api/v1/companies");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await submit({
      name: String(form.get("name") ?? ""),
      website: String(form.get("website") ?? "") || undefined,
      countryCode: String(form.get("countryCode") ?? "") || undefined,
      industry: String(form.get("industry") ?? "") || undefined,
    });
    if (ok) event.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold">Add a company</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="name" required placeholder="Company name" className="input" />
        <input name="website" placeholder="https://example.com" className="input" />
        <input name="countryCode" placeholder="Country (SE)" maxLength={2} className="input" />
        <input name="industry" placeholder="Industry" className="input" />
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {done ? <p className="text-sm text-green-700">{done}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Add company"}
      </button>
    </form>
  );
}

export function CompanyImportForm() {
  const { submit, pending, error, done } = useSubmit("/api/v1/imports");
  const [result, setResult] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File)) return;

    const csv = await file.text();
    const response = await fetch("/api/v1/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        idempotencyKey: `${file.name}:${file.size}:${file.lastModified}`,
        csv,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { data?: { rowCount?: number; errorCount?: number }; error?: { message?: string } }
      | null;

    if (!response.ok) {
      setResult(payload?.error?.message ?? "Import failed");
      return;
    }
    setResult(`Imported ${payload?.data?.rowCount ?? 0} rows, ${payload?.data?.errorCount ?? 0} errors`);
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold">Import companies (CSV)</h2>
      <p className="text-xs muted">
        Columns: name, domain, country_code, industry. Domains are normalised and deduplicated.
      </p>
      <input name="file" type="file" accept=".csv,text/csv" required className="input" />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {done ? <p className="text-sm text-green-700">{done}</p> : null}
      {result ? <p className="text-sm">{result}</p> : null}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Importing…" : "Import CSV"}
      </button>
    </form>
  );
}
