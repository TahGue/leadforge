# crawler

Fetches permitted URLs safely and stores raw artifacts for replay.

**Language:** Python (HTTPX + Playwright) · **Phase:** 4 · **Scales:** horizontally, domain-partitioned

## Contract

- Input: `lf:crawl:fetch` (`target_id`, `url`, `source_id`, `attempt`).
- Output: `fetch_artifacts` row + object in MinIO, then `lf:extract:page`.

## Rules

- Every URL passes the SSRF guard before the request and after each redirect.
- `robots.txt` is fetched, cached (24h), and honoured, including `Crawl-delay`.
- HTTP first; Playwright only when JS rendering is required and budget remains.
- Stop on 401/403/429/451/CAPTCHA/paywall: set domain cooldown, never retry aggressively.
- No stealth flags, no proxy rotation, no CAPTCHA solving, no login sessions.
- Honest UA with contact URL; per-domain concurrency of 1 by default.

## Hard limits

2 MB body, 20s HTTP timeout, 45s browser timeout, 10 redirects, content-type allowlist.

## Does not

- Parse or extract emails (that is `extractor`).
- Decide legal permission (that is `sources` policy + compliance).
