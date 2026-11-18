# Monitoring

`docker compose --profile monitoring up -d` starts Prometheus (scraping `/api/v1/metrics` with `METRICS_TOKEN`) and Grafana on 127.0.0.1:3001 with the **LeadForge pipeline** dashboard (`grafana/dashboards/leadforge.json`).

Before starting:

```bash
printf '%s' "$METRICS_TOKEN" > infrastructure/monitoring/metrics-token   # git-ignored
openssl rand -base64 24 > infrastructure/monitoring/grafana-admin-password   # git-ignored; Grafana user "admin"
```

## Metrics

Computed from Postgres at scrape time (correct with any number of replicas): companies, contacts, evidence coverage, stale companies, open duplicates, emails by status, crawl jobs by status, discovery runs, extraction and staging candidates, pages by HTTP status, pages/bytes fetched, BullMQ queue depth, plus Node process metrics.

## Suggested alerts

- Crawl queue not draining for 30 min while projects are running (`leadforge_crawl_jobs{status="QUEUED"}` flat and > 0).
- `leadforge_crawl_jobs{status="BLOCKED"}` rising quickly: sites refusing access, review the policy stops.
- `leadforge_queue_jobs{queue="dead-letter"}` > 0.
- Evidence coverage below 1.0: a contact without provenance should not exist.
- Backup age > 26 h (from your backup job), disk > 80%.

Logs: every service writes JSON lines to stdout (`docker compose logs`). Ship them with your log collector of choice.
