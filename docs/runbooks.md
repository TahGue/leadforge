# LeadForge — Runbooks

Operational procedures (spec Phase 8). Commands assume Docker Compose on the host.

## Daily

| Check | Where | Healthy |
| --- | --- | --- |
| Health | `curl -s 127.0.0.1:3000/api/v1/health` | `status: ok`, `redis: ok` |
| Queues | **Jobs** page, Grafana "Orchestration queues" | waiting drains, no growing `failed` |
| Policy stops | **Jobs → blocked** | reviewed, never bulk re-queued |
| Review backlog | **Dashboard → Awaiting review** | trending down |
| Errors | `docker compose logs --since 24h web worker crawler \| grep '"level":"error"'` | none unexplained |

## Approve a source

1. **Sources → Review policy.** Read the source's terms and licence yourself.
2. Fill in the terms URL, licence, permitted use, attribution, rate limit and retention.
3. Tick "automated access is permitted" only if the terms say so. Then **Approve**.
4. The approval is audited and bumps the policy version. To withdraw, choose **Restrict** or **Deny**: queued runs for that source stop at their next claim.

## Run a discovery project

1. **Discovery projects → New project.** Set geography, industry, filters and sources, then **Save and preview**.
2. Resolve blockers: unapproved sources, or a missing high-volume approval (admin: **Approve high-volume run**).
3. **Start.** Progress updates live. Sources run first, then normalization, then crawls.
4. Results: **Only records meeting every filter** applies the contact, website and quality filters after crawling.

## A project paused itself

The crawler pauses a project when at least `stopAfterBlocked` sites have refused access **and** refusals make up at least half of the finished crawls (spec §11). A few sites that refuse (HTTP 403, robots.txt) are skipped one by one; refusals becoming the norm suggests the crawler itself is being blocked.

1. Open the project and read **Policy stops**.
2. If sites are blocking the crawler: lower the rate, check `CRAWLER_USER_AGENT`, and check whether the targets fit your sources' permitted use.
3. **Resume** only after deciding. Blocked jobs stay `BLOCKED`; an admin can re-queue a single job from **Jobs** once the cause is resolved.

## A site owner complains

1. Add the domain to the suppression list (**Suppressions → …or a whole domain**). New discovery skips it, and any crawl already queued for it is cancelled before a request is made (`domain_suppressed`).
2. Add it to the project's excluded domains too, so the reason is visible in the project scope.
3. Delete stored raw pages if asked: they age out after `ARTIFACT_RETENTION_DAYS`; for immediate removal, delete the company's `CrawlJob`/`FetchArtifact` rows (pages and candidates cascade).
4. Record the case in the audit trail (settings note) and reply from your crawler policy contact.

## Data-subject requests

- **Erasure:** **Settings → Erasure request** (admin). Removes contact data and evidence for the address and keeps a `LEGAL_OBJECTION` suppression so it is never re-imported.
- **Access:** export the person's rows with `GET /api/v1/contacts?q=<email>` and their evidence (`/api/v1/contacts/:id/evidence`).
- **Objection:** add a suppression (address, or domain for a whole company).

## Worker or crawler stuck

- A job `RUNNING` without a heartbeat for `WORKER_STALE_RUNNING_MINUTES` (default 30) is re-queued automatically by the worker sweep.
- Redis down: health shows `redis: error`. Orchestration continues from the Postgres sweep every `WORKER_POLL_MS`. Restart Redis; nothing is lost.
- Dead letters: jobs exhausted in BullMQ go to the `dead-letter` queue (visible on **Jobs**). The underlying rows stay in Postgres and are retried by the sweep.

## Alerts

Rules: `infrastructure/monitoring/alerts.yml` (see [deployment](./deployment.md#7-monitoring)).

| Alert | First steps |
| --- | --- |
| `LeadForgeWebDown` | `docker compose ps web`; `docker compose logs --tail=200 web`; check `/api/v1/health` (database, PostGIS, Redis). Restart web once the cause is known. |
| `LeadForgeCrawlerStalled` | `docker compose --profile crawler ps crawler`; look for `worker start` and errors in its logs; check Postgres connectivity from the crawler. Stuck `RUNNING` jobs re-queue after `WORKER_STALE_RUNNING_MINUTES`. |
| `LeadForgeCrawlFailuresHigh` | **Jobs → failed**: group by error code. Network-wide failures point at DNS/egress; one site's failures are normal. |
| `LeadForgePolicyStopsSpike` | Follow "A project paused itself". Never bulk re-queue policy stops. |
| `LeadForgeContactsWithoutEvidence` | Find them: contacts with no `SourceEvidence` and no `sourceUrl`. Add evidence or delete them; every contact must be traceable. |

## Large imports

Imports over 500 rows are staged at once and normalized by the worker in batches (`NORMALIZE_CONCURRENCY`, default 8). Progress shows on the import's project. If the worker stops, staged rows stay `PENDING` and resume on restart; re-sending the same file with the same idempotency key returns the original import.

## Retention

Daily in the worker: rejected extraction candidates (`RETENTION_EXTRACTION_CANDIDATES_DAYS`), processed staging rows (`RETENTION_STAGING_DAYS`), audit entries (`RETENTION_AUDIT_DAYS`), expired sessions, and per-source observation retention. Hourly in the crawler: raw page artifacts (`ARTIFACT_RETENTION_DAYS`). Suppressions are never deleted.

## Rotate secrets

- `SESSION_SECRET`: rotating it signs everyone out. Update `.env`, then `docker compose up -d web worker`.
- `METRICS_TOKEN`: update `.env` and `infrastructure/monitoring/metrics-token`, then restart web and prometheus.
- Database password: `ALTER USER leadforge PASSWORD '…'` inside postgres, update `.env`, restart all services.

## Restore

`scripts/restore.sh <dump>` restores into a scratch database, compares row counts with live, and drops it (a drill). `scripts/restore.sh <dump> --replace` restores into the live database after a typed confirmation; stop web, worker and crawler first.

### Restore drill log

| Date | Dump | Size | Restore time | Result | By |
| --- | --- | --- | --- | --- | --- |
| 2026-11-18 | dev stack, all 4 migrations | 270 KB | 2.4 s | Row counts identical (26 companies, 114 cities, 4 migrations); PostGIS 3.5 present | realignment verification |

Repeat each quarter, after major upgrades, and when data volume grows tenfold.
