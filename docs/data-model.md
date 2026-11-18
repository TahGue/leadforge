# LeadForge — Data Model

Companion to [`MEGA-PLAN.md`](./MEGA-PLAN.md) §8. This replaces the illustrative Prisma schema with a production-oriented design. Prisma remains the ORM, but the schema below is the target; migrations land incrementally.

---

## 1. Design rules

1. **Postgres is the only source of truth.** OpenSearch and Redis are disposable.
2. **Every business row is org-scoped** (`organization_id NOT NULL`) except globally shared reference data (`email_addresses`, `domains`, `jurisdictions`, `suppression` global list).
3. **Append-only where history matters**: evidence, verification, eligibility decisions, audit, events, extraction candidates.
4. **No cascade deletes of evidence.** Deleting a company soft-deletes and retains evidence until retention expiry, then hard-deletes via a controlled job.
5. **IDs are `cuid2` (or UUIDv7)** for sortable, non-guessable keys. Public-facing tokens are separate random values.
6. **Timestamps are `timestamptz`**, UTC, `created_at` + `updated_at` everywhere, plus `deleted_at` for soft delete and `retention_until` where law requires expiry.

---

## 2. Entity map

```
organizations ──┬── users ── memberships(role)
                ├── api_keys
                ├── companies ──┬── company_domains ── domains
                │               ├── contacts ── contact_emails ── email_addresses
                │               └── source_evidence
                ├── source_policies ── sources
                ├── discovery_projects ── crawl_targets
                ├── campaigns ── campaign_recipients ── campaign_sends
                ├── segments / icp_profiles
                ├── suppression_entries
                └── audit_logs, domain_events

email_addresses ──┬── email_verifications
                  ├── eligibility_decisions
                  └── email_events

domains ──┬── robots_cache
          ├── crawl_state (cooldown, budget, reputation)
          └── company_domains
```

---

## 3. Core tables

### 3.1 Identity & tenancy

| Table | Key columns | Notes |
| --- | --- | --- |
| `organizations` | `id`, `name`, `slug`, `plan`, `created_at`, `deleted_at` | tenant root |
| `users` | `id`, `email citext unique`, `password_hash`, `totp_secret_enc`, `status`, `last_login_at` | global identity |
| `memberships` | `user_id`, `organization_id`, `role` (`OWNER`/`ADMIN`/`ANALYST`/`VIEWER`), `created_at` | PK (user, org) |
| `sessions` | `id`, `user_id`, `token_hash`, `expires_at`, `ip`, `user_agent`, `revoked_at` | server-side sessions |
| `api_keys` | `id`, `organization_id`, `name`, `prefix`, `key_hash`, `scopes[]`, `last_used_at`, `revoked_at` | show once; hash at rest |

### 3.2 Companies & domains

| Table | Key columns | Notes |
| --- | --- | --- |
| `companies` | `id`, `organization_id`, `name`, `legal_name`, `description`, `country_code`, `region`, `city`, `industry`, `employee_range`, `revenue_range`, `founded_year`, `status`, `confidence numeric`, `first_seen_at`, `last_seen_at`, `retention_until`, `deleted_at` | `status`: `DRAFT`/`ACTIVE`/`STALE`/`ARCHIVED` |
| `domains` | `id`, `domain citext unique`, `registrable_domain`, `tld`, `status`, `last_crawled_at`, `next_crawl_at`, `cooldown_until`, `robots_hash`, `crawl_budget_used` | global; one row per host domain |
| `company_domains` | `company_id`, `domain_id`, `is_primary`, `verified_at` | PK (company, domain); unique `domain_id` globally (a domain belongs to one company) |
| `company_aliases` | `company_id`, `alias`, `normalized`, `source` | fuzzy dedupe support |

Indexes: `(organization_id, name)` btree; GIN trigram on `name`; `(country_code, industry)`; `(organization_id, updated_at desc)` for cursors.

### 3.3 Contacts & emails

| Table | Key columns | Notes |
| --- | --- | --- |
| `contacts` | `id`, `organization_id`, `company_id`, `type` (`PERSON`/`GENERIC_BUSINESS`), `first_name`, `last_name`, `job_title`, `job_function`, `seniority`, `department`, `linkedin_url` (nullable, never scraped), `confidence`, `status`, timestamps | PII minimization: no personal phone/address in v1 |
| `email_addresses` | `id`, `address citext`, `normalized citext unique`, `local_part`, `domain_id`, `status`, `is_role_account`, `is_disposable`, `is_free_provider`, `pattern_inferred`, `first_seen_at`, `last_verified_at`, `verification_expires_at` | global dedupe |
| `contact_emails` | `contact_id`, `email_id`, `is_primary`, `label` (`WORK`/`GENERIC`), `confidence` | PK (contact, email) |
| `email_patterns` | `domain_id`, `pattern` (`first.last`, `f.last`, `first`), `confidence`, `sample_count`, `source` | inference only, never verification |

**Status enum** (separate from campaign eligibility):

```
DISCOVERED | SYNTAX_VALID | DNS_VALID | MX_VALID |
DELIVERABILITY_UNKNOWN | UNDELIVERABLE | RISKY | SUPPRESSED
```

Rules:
- `MX_VALID` never implies inbox existence; UI must label it "domain accepts mail", not "verified".
- `SUPPRESSED` is terminal for sending, regardless of other statuses.
- `pattern_inferred = true` forces `RISKY` until corroborated.

### 3.4 Evidence & crawl

| Table | Key columns | Notes |
| --- | --- | --- |
| `sources` | `id`, `name`, `source_type`, `base_url`, `permitted bool default false`, `policy_notes`, `tos_url`, `tos_reviewed_at`, `reviewed_by`, `rate_limit`, `created_at` | collection blocked unless permitted |
| `source_evidence` | `id`, `organization_id`, `company_id`, `contact_id?`, `email_id?`, `source_id`, `page_url`, `fetch_artifact_id`, `field_name`, `extracted_value`, `extractor_version`, `method`, `snippet`, `observed_at`, `content_hash` | append-only |
| `fetch_artifacts` | `id`, `url`, `final_url`, `status_code`, `content_type`, `body_sha256`, `storage_key`, `size_bytes`, `fetched_at`, `robots_allowed`, `render_mode` | partitioned monthly |
| `crawl_targets` | `id`, `organization_id`, `project_id`, `url`, `url_hash`, `domain_id`, `priority`, `depth`, `status`, `attempts`, `last_error`, `scheduled_for` | unique (project, url_hash) |
| `extraction_runs` | `id`, `fetch_artifact_id`, `extractor_version`, `model_version`, `candidate_count`, `started_at`, `finished_at`, `status` | idempotent on (artifact, extractor_version) |
| `extraction_candidates` | `id`, `run_id`, `organization_id`, `kind` (`EMAIL`/`COMPANY`/`PERSON`), `raw_value`, `normalized_value`, `method`, `selector`, `snippet`, `confidence`, `status` (`PENDING`/`PROMOTED`/`REJECTED`), `reviewed_by`, `reviewed_at`, `reject_reason` | staging; partitioned by month |

### 3.5 Verification

| Table | Key columns | Notes |
| --- | --- | --- |
| `email_verifications` | `id`, `email_id`, `method` (`SYNTAX`/`DNS`/`MX`/`DOMAIN_POLICY`), `result`, `details jsonb`, `checked_at`, `expires_at`, `resolver` | append-only history; latest wins for status |
| `domain_health` | `domain_id`, `mx_present`, `spf_present`, `dmarc_present`, `catch_all_suspected`, `last_checked_at` | heuristic only |

### 3.6 Compliance

| Table | Key columns | Notes |
| --- | --- | --- |
| `jurisdiction_profiles` | `code`, `version`, `status` (`DRAFT`/`APPROVED`/`RETIRED`), `rules jsonb`, `approved_by`, `approved_at`, `notes` | versioned artifacts |
| `consent_records` | `id`, `organization_id`, `email_id`, `purpose`, `source_url`, `evidence jsonb`, `obtained_at`, `withdrawn_at` | affirmative consent only |
| `lawful_basis_records` | `id`, `organization_id`, `email_id`, `basis` (`CONSENT`/`LEGITIMATE_INTEREST`/`CONTRACT`/`LEGAL_OBLIGATION`), `assessment jsonb`, `jurisdiction_code`, `campaign_id?`, `created_at`, `reviewed_by` | LIA stored here |
| `suppression_entries` | `id`, `organization_id?` (null = global), `email_normalized`, `domain?`, `reason`, `source`, `created_at`, `lifted_at`, `lifted_by` | unique (org, email, reason) |
| `eligibility_decisions` | `id`, `organization_id`, `email_id`, `campaign_id`, `context_hash`, `rule_set_version`, `outcome`, `reasons jsonb`, `decided_at`, `expires_at`, `superseded_by` | append-only, expiring |
| `data_subject_requests` | `id`, `organization_id`, `type` (`ACCESS`/`ERASURE`/`OBJECTION`/`RECTIFICATION`), `subject_email`, `status`, `received_at`, `due_at`, `completed_at`, `evidence jsonb` | SLA tracking |

### 3.7 CRM & campaigns

| Table | Key columns | Notes |
| --- | --- | --- |
| `segments` | `id`, `organization_id`, `name`, `definition jsonb`, `definition_version`, `created_by` | reproducible query |
| `icp_profiles` | `id`, `organization_id`, `name`, `criteria jsonb`, `weights jsonb` | drives scoring + discovery |
| `campaigns` | `id`, `organization_id`, `name`, `subject`, `body_html`, `body_text`, `status`, `segment_id`, `jurisdiction_scope`, `lawful_basis`, `approved_by`, `approved_at`, `scheduled_at`, timestamps | status machine below |
| `campaign_recipients` | `id`, `campaign_id`, `email_id`, `email_snapshot`, `status`, `eligibility_decision_id`, `queued_at`, `sent_at`, `error` | unique (campaign, email_id) |
| `campaign_sends` | `id`, `campaign_id`, `recipient_id`, `attempt`, `provider`, `provider_message_id`, `smtp_response`, `sent_at` | delivery attempts |
| `email_templates` | `id`, `organization_id`, `name`, `subject`, `html`, `text`, `variables jsonb`, `version` | versioned |
| `email_events` | `id`, `organization_id`, `email_id`, `campaign_id?`, `type` (`SENT`/`DELIVERED`/`BOUNCE_HARD`/`BOUNCE_SOFT`/`COMPLAINT`/`UNSUBSCRIBE`/`OPEN`?), `provider_message_id`, `occurred_at`, `metadata jsonb` | partitioned monthly; opens optional and privacy-sensitive |
| `suppression_tokens` | `token unique`, `email_id`, `campaign_id`, `created_at`, `used_at` | signed unsubscribe links |

**Campaign status machine**

```
DRAFT → REVIEW → (approved) → SCHEDULED → RUNNING → COMPLETED
                    │                        │
                    └── CANCELLED ◄──────────┴── PAUSED → RUNNING
```

Illegal transitions rejected in a single `assertTransition()` in the domain layer, not in the UI.

### 3.8 Platform

| Table | Notes |
| --- | --- |
| `audit_logs` | append-only, partitioned monthly, `actor_id`, `action`, `entity`, `entity_id`, `before/after` hashes, `ip`, `request_id`; no UPDATE/DELETE grants |
| `domain_events` | transactional outbox (see architecture) |
| `scheduled_jobs` | cron definitions + leases, unique on `(job_key, run_at)` |
| `imports` | CSV import jobs with idempotency key, row counts, error report |
| `search_documents` (optional) | projection synced to OpenSearch with `version` for idempotent upserts |

---

## 4. Multi-tenancy and RLS

Application-level scoping is mandatory but insufficient. Enable Postgres RLS on every org-scoped table:

```sql
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_org_isolation ON companies
  USING (organization_id = current_setting('app.organization_id')::text);
```

- The API sets `SET LOCAL app.organization_id = $1` per transaction.
- The migration/runtime role used by background jobs sets an explicit service context and is audited.
- CI includes a "tenant leak suite": for each endpoint, authenticate as org A, request org B's resource id, expect 404 (not 403, to avoid existence leaks).

---

## 5. Partitioning and retention

| Table | Partition | Retention |
| --- | --- | --- |
| `fetch_artifacts` | monthly | 90 days (configurable), then delete artifact + object |
| `extraction_candidates` | monthly | 180 days after review |
| `email_events` | monthly | 24 months |
| `audit_logs` | monthly | 24 months (or contract) |
| `email_verifications` | none (indexed) | 24 months |

Retention runs as a scheduled job with dry-run mode, writes an audit row per purge, and respects legal holds (`suppression_entries` and open DSRs are never purged).

---

## 6. Indexing

Must-have:

```sql
CREATE INDEX ON companies (organization_id, updated_at DESC, id);
CREATE INDEX ON companies USING gin (name gin_trgm_ops);
CREATE INDEX ON email_addresses (domain_id, status);
CREATE INDEX ON contact_emails (email_id);
CREATE INDEX ON source_evidence (email_id, observed_at DESC);
CREATE INDEX ON crawl_targets (organization_id, status, priority, scheduled_for);
CREATE INDEX ON campaign_recipients (campaign_id, status);
CREATE INDEX ON email_events USING brin (occurred_at);
CREATE UNIQUE INDEX ON eligibility_decisions (email_id, campaign_id, context_hash) WHERE superseded_by IS NULL;
```

Full-text: `companies.search_vector tsvector GENERATED ALWAYS AS (...) STORED` + GIN, until OpenSearch exists.

---

## 7. Migration policy

- Prisma Migrate, one logical change per migration, forward-only in production.
- Destructive changes require expand/contract (add column → backfill → switch reads → drop later).
- Every migration tested against a production-sized anonymized dump before release.
- No `prisma db push` outside local dev. CI fails on drift.
- Seed data lives in `packages/database/seed` and is idempotent.

---

## 8. Prisma specifics vs raw SQL

Prisma cannot express RLS, generated columns, partial indexes, or partitioning. Therefore:

- Prisma schema models the tables; RLS/policies/partitions/generated columns live in `packages/database/sql/` applied by a custom migration step after `prisma migrate deploy`.
- Heavy analytics and bulk operations use `$queryRaw` with tagged templates (never string interpolation).
