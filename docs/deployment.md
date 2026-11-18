# Deploying LeadForge

Target: a single Linux host with Docker Compose, plus optional separate mail host.
Everything below assumes you own the domain and can set DNS records.

---

## 1. What you are deploying

| Container | Role | Required |
| --- | --- | --- |
| `postgres` | source of truth | yes |
| `migrate` | one-shot `prisma migrate deploy` | yes (runs to completion) |
| `web` | dashboard + `/api/v1` | yes |
| `worker` | campaign sends, bounce-driven state | yes |
| `crawler` | outbound crawl/extract (profile) | only when crawling |
| `redis` | cache/queue headroom for future work | included, not yet on the hot path |

Mail is deliberately **not** part of the default stack. See §7.

---

## 2. Prerequisites

- Docker Engine 24+ with Compose v2
- A host with at least 4 vCPU / 8 GB RAM for the app + database (16 GB if you crawl a lot)
- 20 GB free disk for Postgres, artifacts, and backups
- A domain and the ability to create DNS records
- TLS termination: Caddy, nginx, or a load balancer in front of `web`

---

## 3. Configure

```bash
cp .env.example .env
```

Minimum values to change:

```ini
APP_URL=https://leads.example.com
POSTGRES_PASSWORD=<long random>
SESSION_SECRET=<openssl rand -base64 48>
UNSUBSCRIBE_SIGNING_KEY=<openssl rand -base64 48>
MAIL_POSTAL_ADDRESS=Example AB, Storgatan 1, 111 22 Stockholm, Sweden
```

Notes:

- `SESSION_SECRET` must be 32+ characters; the app refuses to boot in production otherwise.
- `MAIL_POSTAL_ADDRESS` is mandatory before any campaign can become eligible: sender identity is a compliance requirement, not a template nicety.
- `DATABASE_URL` is constructed inside `docker-compose.yml`; you do not set it by hand.
- Never commit `.env`. For production prefer Docker secrets or your orchestrator's secret store.

### Secrets via files

Compose reads the environment above. If you need file-based secrets, mount them and adjust `x-app-env` in `docker-compose.yml` to use `*_FILE` variables — the app currently reads values directly, so keep the compose file as the single source.

---

## 4. Start

```bash
docker compose build
docker compose up -d
docker compose ps
```

`migrate` must exit 0 before `web` and `worker` start; the dependencies enforce this.

Create the first organization and user (run once):

```bash
docker compose exec web node packages/database/prisma/seed.mjs
```

The seed is idempotent. Set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in the environment **before** running it, or change the password immediately after first login.

Check health:

```bash
curl -fsS https://leads.example.com/api/v1/health
# {"status":"ok","checks":{"database":"up",...}}
```

---

## 5. Reverse proxy

Caddy example:

```caddyfile
leads.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

The app sets HSTS-adjacent headers itself; add HSTS at the proxy once TLS is stable. Keep port 3000 bound to loopback (the compose file already does).

---

## 6. Crawling

The crawler is opt-in because it makes outbound requests:

```bash
docker compose --profile crawler up -d crawler
```

Before enabling it:

1. Register at least one source and record the policy review (Sources → Approve).
2. Read the crawl rules in [`architecture.md`](./architecture.md) and [`security.md`](./security.md).
3. Keep `CRAWLER_DELAY_MS` at 2000 or higher until you know the target sites tolerate more.

Artifacts are stored in the `artifacts` volume. They are retained according to your policy (default 90 days, see `docs/quality-gates.md`).

---

## 7. Mail (only after the gates)

Outbound mail stays in test mode until all of the following are true:

1. Dedicated sending subdomain with SPF, DKIM (2048-bit), and DMARC reporting.
2. Static IP with matching PTR and forward DNS, port 25 outbound.
3. TLS certificate for the submission host.
4. Postfix configured with SASL auth and `smtpd_relay_restrictions = permit_sasl_authenticated, reject`.
5. `.env`: `MAIL_ENABLED=true`, `SMTP_*`, `MAIL_POSTAL_ADDRESS`, `UNSUBSCRIBE_SIGNING_KEY`.
6. Seed-inbox test passes (Gmail, Outlook, Yahoo) for SPF/DKIM/DMARC alignment.
7. At least one jurisdiction profile is `APPROVED` in Settings.

Then set `MAIL_ENABLED=true` and restart `worker`:

```bash
docker compose up -d worker
```

Warmup: start with a handful of recipients per day, watch bounce (<2%) and complaint (<0.1%) rates. The worker refuses to send when no `UNSUBSCRIBE_SIGNING_KEY` is configured.

`docker-compose.mail.yml` is intentionally not shipped: Postfix + DKIM + PTR setup is host-specific and should be configured deliberately, not templated blindly. `infrastructure/postfix/README.md` contains the required configuration and DNS records.

---

## 8. Backups

```bash
./scripts/backup.sh
```

Produces `backups/leadforge-<timestamp>.dump` plus a manifest, and prunes by `BACKUP_RETENTION_DAYS`.
Schedule it with cron/systemd timers and copy off-host, encrypted.

Restore drill (do this before you need it):

```bash
docker compose exec -T postgres pg_restore -U leadforge -d leadforge --clean --if-exists < backup.dump
```

Verify: row counts, `/api/v1/health`, a company detail page, and one eligibility evaluation.

---

## 9. Upgrades

```bash
git pull
docker compose build
docker compose run --rm migrate
docker compose up -d
```

The schema is forward-only; migrations use expand/contract for breaking changes. Take a backup before `migrate` on any release that touches the schema.

---

## 10. Operations checklist

- [ ] `APP_URL` uses https and matches the proxy
- [ ] `SESSION_SECRET` and `UNSUBSCRIBE_SIGNING_KEY` are unique and backed up
- [ ] Postgres port is not reachable from the internet
- [ ] Backups run daily and a restore has been tested
- [ ] `/api/v1/health` is monitored
- [ ] `MAIL_ENABLED=false` until the mail gates pass
- [ ] Jurisdiction profiles show `APPROVED` only where counsel signed off
- [ ] Suppression table is reviewed before the first real campaign
- [ ] Log retention and PII masking are configured at the log driver

---

## 11. Local development without Docker

Docker may be unavailable on some workstations. Two options:

1. Install PostgreSQL and Redis natively, set `DATABASE_URL`, run `pnpm db:deploy && pnpm db:seed`.
2. Use the bundled PGlite harness:

```bash
node scripts/dev-db.mjs          # Postgres wire protocol on 127.0.0.1:5432
node scripts/db-apply.mjs        # apply migrations without the Prisma engine
pnpm --filter @leadforge/database seed
pnpm dev
```

Add `?pgbouncer=true&connection_limit=1` to `DATABASE_URL` when using PGlite: it speaks the wire protocol but does not support Prisma's prepared-statement reuse. Never use that DSN in production.
