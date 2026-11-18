"use client";

import { useState } from "react";
import { api } from "@/lib/client";

/** Data-subject erasure: removes a person's contact data and keeps a suppression entry. */
export function EraseForm() {
  const [email, setEmail] = useState("");
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!window.confirm(`Erase all contact data for ${email}? This cannot be undone; the address stays suppressed.`)) return;
    try {
      const result = await api<{ contacts: number }>("/api/v1/data-requests/erase", { body: { email, reference: reference || undefined } });
      setMessage(`Erased. ${result.contacts} contact link(s) removed; the address is suppressed.`);
      setEmail("");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" />
      <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Request reference (optional)" />
      <button type="submit" className="btn text-xs">
        Erase and suppress
      </button>
      {message ? <p className="text-xs">{message}</p> : null}
    </form>
  );
}
