# Monitoring

Metrics, logs, dashboards, alerts, and runbooks.

## Stack (Phase 10)

Prometheus + Grafana + Loki, all local. Optional export to an external collector.

## What must be alerted

- Crawl queue lag > 15 min, DLQ growth, crawl success rate < 85%.
- Review backlog age > 7 days.
- Verification job failures, DNS resolver errors.
- Eligibility engine errors (never silently allow).
- Send volume anomaly (> 3x rolling mean), bounce > 2%, complaint > 0.1%.
- Postgres connections > 80%, disk > 80%, backup age > 26h.

## Runbooks

`runbooks/` — one page per alert: symptom, impact, first checks, mitigation, escalation.
