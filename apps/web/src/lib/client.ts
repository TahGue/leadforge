/** Browser-side API helper. Same-origin JSON requests; errors surface the API message. */
export class ClientApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(url, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: { message?: string; details?: unknown } } | null;
  if (!response.ok) {
    throw new ClientApiError(payload?.error?.message ?? `Request failed (${response.status})`, response.status, payload?.error?.details);
  }
  return (payload?.data ?? payload) as T;
}
