"use client";

/** Source policy review (spec 10): approval needs terms URL, permitted use and explicit automated-access confirmation. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export interface SourcePolicy {
  id: string;
  name: string;
  sourceType: string;
  policyStatus: string;
  enabled: boolean;
  tosUrl: string | null;
  licenceName: string | null;
  licenceUrl: string | null;
  permittedUse: string | null;
  attribution: string | null;
  policyNotes: string | null;
  automatedAccessAllowed: boolean;
  commercialReuseAllowed: boolean;
  retentionDays: number | null;
  requestsPerMinute: number | null;
}

export function SourcePolicyForm({ source }: { source: SourcePolicy }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(source);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(policyStatus: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/sources/${source.id}`, {
        method: "PATCH",
        body: {
          policyStatus,
          enabled: state.enabled,
          tosUrl: state.tosUrl || undefined,
          licenceName: state.licenceName || undefined,
          licenceUrl: state.licenceUrl || undefined,
          permittedUse: state.permittedUse || undefined,
          attribution: state.attribution || undefined,
          policyNotes: state.policyNotes || undefined,
          automatedAccessAllowed: state.automatedAccessAllowed,
          commercialReuseAllowed: state.commercialReuseAllowed,
          retentionDays: state.retentionDays,
          ...(state.requestsPerMinute ? { rateLimitJson: { requestsPerMinute: state.requestsPerMinute } } : {}),
        },
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn text-xs" onClick={() => setOpen(true)}>
        Review policy
      </button>
    );
  }

  const text = (key: keyof SourcePolicy, label: string, placeholder?: string) => (
    <label className="text-xs">
      <span className="muted">{label}</span>
      <input
        className="input mt-1"
        value={(state[key] as string | null) ?? ""}
        placeholder={placeholder}
        onChange={(e) => setState({ ...state, [key]: e.target.value || null })}
      />
    </label>
  );

  return (
    <div className="mt-2 space-y-3 rounded border border-[var(--lf-line)] bg-[#fbfbfa] p-3">
      <div className="grid gap-2 md:grid-cols-2">
        {text("tosUrl", "Terms / usage policy URL", "https://…")}
        {text("licenceName", "Licence", "e.g. ODbL 1.0, CC BY 4.0")}
        {text("licenceUrl", "Licence URL")}
        {text("attribution", "Required attribution")}
      </div>
      <label className="block text-xs">
        <span className="muted">Permitted use (what the terms allow)</span>
        <textarea className="input mt-1" rows={2} value={state.permittedUse ?? ""} onChange={(e) => setState({ ...state, permittedUse: e.target.value || null })} />
      </label>
      <label className="block text-xs">
        <span className="muted">Review notes</span>
        <textarea className="input mt-1" rows={2} value={state.policyNotes ?? ""} onChange={(e) => setState({ ...state, policyNotes: e.target.value || null })} />
      </label>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={state.automatedAccessAllowed} onChange={(e) => setState({ ...state, automatedAccessAllowed: e.target.checked })} />
          Automated access is permitted by the source
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={state.commercialReuseAllowed} onChange={(e) => setState({ ...state, commercialReuseAllowed: e.target.checked })} />
          Commercial reuse is permitted
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={state.enabled} onChange={(e) => setState({ ...state, enabled: e.target.checked })} />
          Enabled
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            <span className="muted">Retention (days)</span>
            <input type="number" className="input mt-1" value={state.retentionDays ?? ""} onChange={(e) => setState({ ...state, retentionDays: e.target.value ? Number(e.target.value) : null })} />
          </label>
          <label className="text-xs">
            <span className="muted">Requests / minute</span>
            <input type="number" className="input mt-1" value={state.requestsPerMinute ?? ""} onChange={(e) => setState({ ...state, requestsPerMinute: e.target.value ? Number(e.target.value) : null })} />
          </label>
        </div>
      </div>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary text-xs" disabled={busy} onClick={() => save("APPROVED")}>
          Approve
        </button>
        <button type="button" className="btn text-xs" disabled={busy} onClick={() => save("RESTRICTED")}>
          Restrict
        </button>
        <button type="button" className="btn text-xs" style={{ color: "#a12b1f" }} disabled={busy} onClick={() => save("DENIED")}>
          Deny
        </button>
        <button type="button" className="btn text-xs" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}
