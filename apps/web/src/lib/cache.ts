/**
 * Small per-process TTL cache for expensive dashboard aggregates (performance.md:
 * the email-status breakdown is ~0.3 s at 1M rows). Keys must include the
 * organization id. Concurrent callers share one in-flight promise.
 */
const entries = new Map<string, { expires: number; value: Promise<unknown> }>();
const MAX_ENTRIES = 1_000;

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  if (entries.size >= MAX_ENTRIES) {
    for (const [k, entry] of entries) if (entry.expires <= now) entries.delete(k);
    if (entries.size >= MAX_ENTRIES) entries.clear();
  }
  const value = load().catch((error: unknown) => {
    entries.delete(key); // never cache a failure
    throw error;
  });
  entries.set(key, { expires: now + ttlMs, value });
  return value;
}

export function clearCache(): void {
  entries.clear();
}
