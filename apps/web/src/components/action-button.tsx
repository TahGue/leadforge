"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ActionButtonProps {
  url: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  label: string;
  pendingLabel?: string;
  confirmText?: string;
  variant?: "default" | "primary" | "danger";
  className?: string;
}

export function ActionButton({
  url,
  method = "POST",
  body,
  label,
  pendingLabel = "Working…",
  confirmText,
  variant = "default",
  className,
}: ActionButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (confirmText && !window.confirm(confirmText)) return;
    setPending(true);
    setError(null);

    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(payload?.error?.message ?? `Request failed (${response.status})`);
      setPending(false);
      return;
    }

    setPending(false);
    router.refresh();
  }

  const variantClass =
    variant === "primary" ? "btn btn-primary" : variant === "danger" ? "btn" : "btn";

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={`${variantClass} ${className ?? ""}`}
        style={variant === "danger" ? { color: "#a12b1f" } : undefined}
      >
        {pending ? pendingLabel : label}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
