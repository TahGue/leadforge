# Deploying LeadForge

Self-hosted with Docker Compose (spec §23). One host is enough for the first 100,000 records ([performance](./performance.md)).

## 1. What you are deploying

| Service | Image / build | Purpose | Exposed |
| --- | --- | --- | --- |
| `postgres` | `postgis/postgis:16-3.5` | System of record, spatial queries | no |
| `redis` | `redis:7.4-alpine` | BullMQ orchestration queues (rebuildable) | no |
| `migrate` | web image | `prisma migrate deploy`, then reference data | no (one-shot) |
| `web` | `apps/web/Dockerfile` | UI and `/api/v1` | 127.0.0.1:3000 |
| `worker` | `apps/worker/Dockerfile` | Normalization, dedup, verification, completion, retention | no |
| `crawler` (profile `crawler`) | `services/Dockerfile` | Source adapters, website crawler, AI classification, artifact retention | no |
| `ollama` (profile `ai`) | `ollama/ollama` | Local inference | no |
| `prometheus`, `grafana` (profile `monitoring`) | upstream images | Metrics and dashboard | Grafana 127.0.0.1:3001 |

## 2. Prerequisites

- Linux host (Ubuntu 24.04/26.04 tested), 4 vCPU, 8 GB RAM, SSD. Add a GPU or 16 GB RAM for Ollama.
- Docker Engine with the Compose plugin. Membership in the `docker` group is root-equivalent.
- A domain and TLS certificate for remote access through a reverse proxy.
- A page describing your crawler, linked from its user agent.

## 3. Configure

```bash
cp .env.example .env
openssl rand -base64 48      # SESSION_SECRET
openssl rand -base64 32      # POSTGRES_PASSWORD, METRICS_TOKEN
```

Required: `POSTGRES_PASSWORD`, `SESSION_SECRET` (32+ chars), `APP_URL` (the public https URL; secure cookies follow its scheme), `CRAWLER_USER_AGENT` (truthful, with a contact URL; never impersonate anyone).

Recommended: `METRICS_TOKEN`; `NEXT_PUBLIC_MAP_STYLE_URL` (a permitted or self-hosted tile style, applied at image build); `DISCOVERY_HIGH_VOLUME_THRESHOLD`; retention days.

Leave `FEATURE_CAMPAIGNS=false` until the Phase 9 legal review is complete.

## 4. Start

```bash
docker compose up -d --build                       # core services
docker compose --profile crawler up -d             # discovery and crawling
docker compose exec web node packages/database/prisma/seed.mjs   # first admin (then change its password)
curl -s http://127.0.0.1:3000/api/v1/health        # {"status":"ok","checks":{"database":"up","postgis":"up","redis":"ok",...}}
```

The `migrate` service runs on every `up`. It is idempotent: it applies pending migrations and reloads the geography seed and taxonomy.

### More geography

The bundled seed covers all countries and continents, plus regions and major cities for SE, NO, DK, FI, DE and GB. Download GeoNames files (CC BY 4.0) and import:

```bash
docker compose cp ./geonames web:/tmp/geonames
docker compose exec web node scripts/import-geonames.mjs --dir /tmp/geonames --countries SE,NO,DK,FI --cities cities1000.txt
```

## 5. Reverse proxy

Terminate TLS in front of `127.0.0.1:3000` (Caddy, nginx or Traefik). Forward `X-Forwarded-For`, set `APP_URL=https://…`, and do not expose Grafana publicly without authentication. Do not publish Postgres, Redis or Ollama (spec §23).

## 6. Sources and crawling

1. **Sources:** review each source's terms and licence, record permitted use and attribution, confirm automated access, then approve. Unreviewed sources never run.
2. **Open datasets:** put registry exports in `data/imports/` (mounted read-only) and point the source's `config.path` at them.
3. **OpenStreetMap:** prefer a self-hosted Overpass instance (`config.endpoint`). Public instances are shared and rate limited.
4. **Crawler limits:** `CRAWLER_GLOBAL_CONCURRENCY` (jobs in parallel; one per domain), `CRAWLER_DELAY_MS`, `CRAWLER_MAX_RESPONSE_MB`. Projects set their own rate, page and depth budgets.
5. **Browser rendering:** build the crawler with `CRAWLER_INSTALL_BROWSER=true` and set `CRAWLER_PLAYWRIGHT_ENABLED=true`. Projects must also opt in.
6. **Local AI:** `docker compose --profile ai up -d`, pull candidate models (`docker compose exec ollama ollama pull <model>`), and benchmark them with the production prompt and grounding check:

   ```bash
   python -m leadforge.ai_eval --model <model-a> --model <model-b> --out reports/ai-eval.md
   ```

   Pick the model with the fewest **false stores** (wrong codes that would be saved), then accuracy and latency. Set `OLLAMA_CLASSIFICATION_MODEL`, `OLLAMA_ENABLED=true`, and restart the crawler. The bundled set (`tests/golden/classification.jsonl`) is synthetic; add real, hand-labelled companies from your market for a decision you can rely on. Results so far are in [performance](./performance.md#local-ai-classification).

   The same setting powers **Detect from a keyword** in the project wizard (`POST /api/v1/industries/suggest`): the web app asks the model to map a keyword such as "olive oil producer" to taxonomy codes and to propose include/exclude keywords. Codes the model invents are discarded, confidence is capped at 0.85, and nothing is stored until the user applies the suggestion and saves the project. With `OLLAMA_ENABLED=false`, or when the model fails or times out (`OLLAMA_SUGGEST_TIMEOUT_MS`, default 120000), the wizard falls back to the taxonomy aliases and says why. Restart the web app after changing these settings.

## 7. Monitoring

```bash
printf '%s' "$METRICS_TOKEN" > infrastructure/monitoring/metrics-token
openssl rand -base64 24 > infrastructure/monitoring/grafana-admin-password
docker compose --profile monitoring up -d
```

Grafana runs at http://127.0.0.1:3001 with the "LeadForge pipeline" dashboard. All services log JSON to stdout (`docker compose logs`); connection-string passwords, bearer tokens and session cookies are redacted before logging.

Prometheus loads the alert rules in `infrastructure/monitoring/alerts.yml`: web down, crawler stalled with a backlog, crawl failure spike, policy-stop spike, contacts without evidence. CI unit-tests every rule against induced failures (`alerts.test.yml`). Firing alerts appear at Prometheus `/alerts` and in Grafana; to page a person, add an Alertmanager or a Grafana contact point (email, Slack, etc.).

## 8. Backups

```bash
scripts/backup.sh                                     # nightly via cron; pg_dump custom format + manifest
scripts/restore.sh backups/leadforge-<stamp>.dump     # restore drill into a scratch database
```

Back up the `artifacts` volume separately if you keep raw pages. Encrypt backups and copy them off the host. Run a restore drill each quarter and log it in the [runbooks](./runbooks.md#restore-drill-log).

## 9. Upgrades

```bash
scripts/backup.sh
git pull
docker compose --profile crawler build
docker compose --profile crawler up -d      # migrate runs first; web and workers wait for it
```

Migrations are forward-only. To roll back, restore the pre-upgrade backup and redeploy the previous tag.

## 10. Production checklist

- [ ] `.env` secrets generated, not defaults; `.env` mode 600
- [ ] `APP_URL` is https behind a TLS proxy; only ports 80/443 open on the host firewall
- [ ] Demo admin password changed or demo organization removed
- [ ] `CRAWLER_USER_AGENT` names you and links a crawler policy page
- [ ] Every enabled source has an approved policy, licence and attribution recorded
- [ ] `METRICS_TOKEN` set; Grafana not public
- [ ] Nightly `scripts/backup.sh`, offsite copy, restore drill logged
- [ ] Retention values reviewed with your privacy policy (`RETENTION_*`, `ARTIFACT_RETENTION_DAYS`)
- [ ] `FEATURE_CAMPAIGNS=false` (Phase 9 not approved)
- [ ] Image versions pinned (they are in `docker-compose.yml`); dependency updates reviewed monthly
