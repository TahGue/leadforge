import { ApiError } from "@leadforge/shared";

/**
 * Process-local fixed-window limiter.
 *
 * Correct for a single instance, which is the v1 deployment shape. When the
 * app scales horizontally this must move to Redis — tracked in the backlog.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    const seconds = Math.ceil((bucket.resetAt - now) / 1000);
    throw new ApiError(429, "RATE_LIMITED", `Too many requests; retry in ${seconds}s`);
  }
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}
