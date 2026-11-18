# LeadForge — Security & Threat Model

Companion to [`MEGA-PLAN.md`](./MEGA-PLAN.md) §13. LeadForge is a system that deliberately fetches untrusted content from the internet and stores personal data. Treat both as hostile.

---

## 1. Assets

| Asset | Impact if compromised |
| --- | --- |
| Contact database (PII) | privacy breach, regulatory exposure, reputational death |
| Consent / basis / suppression records | inability to prove compliance; unlawful sends |
| SMTP credentials + sending domain | domain blacklisting, spam campaigns attributed to you |
| Session cookies / API keys | account takeover, data exfiltration |
| Raw page artifacts | stored XSS vector, copyright exposure |
| Backups | full-database loss |
| Audit log | loss of non-repudiation |

## 2. Actors and trust boundaries

```
[ operator browser ] --untrusted--> [ web/api ] --trusted--> [ postgres ]
                                         |
                                         +--untrusted--> [ internet pages ]  (crawler)
                                         +--semi-------> [ ollama ]            (untrusted output)
                                         +--untrusted--> [ inbound mail ]      (DSN/ARF)
```

Everything crossing into the system is validated and treated as data: page HTML, LLM output, CSV imports, DSN bodies, webhook payloads.

---

## 3. Threat table

| # | Threat | Vector | Control |
| --- | --- | --- | --- |
| T1 | SSRF to internal services / cloud metadata | crawl URL, redirect, DNS rebinding | URL validator + IP allowlist/denylist + DNS pinning + redirect re-validation + egress firewall |
| T2 | Stored XSS from scraped pages | evidence viewer renders raw HTML | never render raw HTML; sanitize with DOMPurify if ever needed; CSP |
| T3 | Prompt injection via page content | hidden text instructs the model | content wrapped as data, no tools, schema-constrained output, model output never triggers actions |
| T4 | Cross-tenant data leak | missing org filter | mandatory scoping helper + RLS + tenant-leak test suite |
| T5 | Credential stuffing / brute force | login endpoint | Argon2id, rate limit per IP+account, lockout with backoff, optional TOTP |
| T6 | Session theft | XSS / network | httpOnly, Secure, SameSite=Lax, short TTL, rotation on privilege change |
| T7 | API key leakage | logs, git, screenshots | hashed at rest, prefix-only display, scoped, revocable, never logged |
| T8 | SMTP relay abuse | compromised account sends spam | submission auth required, per-account rate limit, relay restricted to local domains, monitoring on volume spikes |
| T9 | Mail bombing / bounce flood | inbound DSN parsing | size caps, rate limits, quarantine, parser hardening |
| T10 | CSV / formula injection | export opened in Excel | prefix `'` on cells starting with `= + - @ \t \r`, documented |
| T11 | CSV import resource exhaustion | huge file / zip bomb | row caps, stream parsing, size limits, no zip support in v1 |
| T12 | Queue poisoning | forged job payload | workers validate payload schema + verify referenced row exists and belongs to org |
| T13 | Unsubscribe token forgery | guessable tokens | HMAC-signed tokens with email + campaign + expiry, constant-time compare |
| T14 | Evidence tampering | DB write access | append-only tables, restricted grants, hash chain in audit log |
| T15 | Backup theft | offsite storage | client-side encryption, separate key, restore audit |
| T16 | Accidental mass send | UI misuse | four-eyes approval, eligibility gate, kill switch, test allowlist |

---

## 4. SSRF guard (the critical control)

Implemented once in `packages/shared/net/guard` (TS) and `services/crawler/safety` (Python), with identical conformance tests.

1. Parse URL strictly (`urlparse`); reject non-http(s), userinfo, non-default ports unless allowlisted, IP literals.
2. Reject hostnames resolving to:
   - loopback `127.0.0.0/8`, `::1`
   - private `10/8`, `172.16/12`, `192.168/16`, `fc00::/7`
   - link-local `169.254/16`, `fe80::/10`
   - CGNAT `100.64/10`
   - multicast, broadcast, reserved, documentation ranges
   - cloud metadata `169.254.169.254`, `metadata.google.internal`
3. Resolve DNS once; validate **every** returned A/AAAA; pin the connection to the validated IP while preserving the `Host` header.
4. Re-validate after each redirect (max 10); reject downgrade to non-http(s).
5. Deny by default for egress: container firewall allows only 80/443 outbound from crawl workers.
6. Test corpus includes: decimal/octal/hex IP encodings, `0.0.0.0`, `[::]`, `localhost.`, trailing-dot tricks, DNS rebinding scenario, redirect chains, IPv6-mapped IPv4.

---

## 5. Authentication & authorization

- Local accounts only in v1 (no OAuth dependency). Email + Argon2id (memory 64 MB, iterations 3, parallelism 4).
- Sessions in DB, token = 256-bit random, stored hashed; idle timeout 7 days, absolute 30 days.
- RBAC: `OWNER` (billing/org), `ADMIN` (settings, sources, users), `ANALYST` (data, review, campaigns), `VIEWER` (read-only). Enforced server-side per route, not in the UI.
- Authorization helper: `requireOrg(user, orgId)` + `requireRole(...)`; every handler calls it before touching data. A route without it fails a CI lint rule.
- API keys carry scopes; key auth is org-bound and rate-limited per key.

---

## 6. Secrets

| Secret | Dev | Prod |
| --- | --- | --- |
| DB password | `.env` (gitignored) | Docker secret / mounted file |
| Session/CSRF/HMAC keys | `.env` | Docker secret, rotatable |
| DKIM private key | n/a | file mount, 0600, not in image |
| SMTP credentials | n/a | Docker secret |
| Encryption key (PII) | `.env` | external file + rotation runbook |

Rules: secrets never in logs, never in error messages, never in client bundles. CI runs a secret scanner (gitleaks) and fails on match. Rotation procedure documented and tested annually.

---

## 7. PII protection

- Minimization: only work contact data, no special categories, no home data.
- At-rest: full-disk encryption on host; column-level encryption (`pgcrypto` or app-level envelope) for consent evidence and contact PII in regulated deployments.
- In transit: TLS everywhere, Postgres TLS optional on private network (recommended on).
- Access: audit every read of a contact detail by a non-owner role (v2), every export.
- Logs: never log email bodies, full email addresses (mask `a***@domain`), tokens, or page content.

---

## 8. Application hardening

- CSP: `default-src 'self'`; no inline scripts in production; frame-ancestors none.
- Security headers: HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- CSRF: SameSite cookies + double-submit token on state-changing routes.
- Rate limiting: Redis token bucket per IP and per account on auth, import, export, evaluate, send-test.
- Input validation: Zod at every boundary; unknown keys rejected; max body sizes.
- Output encoding: React auto-escaping; no `dangerouslySetInnerHTML` anywhere except a reviewed, sanitized template renderer.
- Dependency hygiene: pnpm audit + `pip-audit` in CI; Dependabot; lockfiles committed.
- Containers: non-root user, read-only rootfs where possible, no privileged, dropped capabilities, pinned digests.

---

## 9. Mail system security

- Postfix: `smtpd_sasl_auth_enable=yes`, `smtpd_relay_restrictions=permit_sasl_authenticated,reject`, `disable_vrfy_command=yes`, TLS required for submission.
- OpenDKIM key readable only by opendkim; milter socket private.
- No open relay: automated test from an unauthenticated external IP must be rejected.
- Inbound mail ports (25) only on the mail host; app network cannot reach Postfix submission except campaign worker.
- DMARC reports parsed into a dedicated mailbox, summarized, not stored raw beyond 30 days.
- Volume anomaly alert: >3x rolling hourly average → pause + page operator.

---

## 10. Incident response

1. Detect (alert/metrics/anomaly).
2. Contain: kill switch for sending; revoke sessions/API keys; isolate host.
3. Assess: scope query by `audit_logs` and `domain_events`.
4. Notify: internal log; regulatory notification assessment within 72h where GDPR applies; affected parties if required.
5. Remediate + post-mortem within 5 business days, with a tracked action item.
6. Update threat model and tests.

Runbooks live in `infrastructure/monitoring/runbooks/`; a tabletop exercise is part of Phase 10.

---

## 11. Security acceptance checklist

- [ ] SSRF suite green (both languages, identical fixtures)
- [ ] Tenant-leak suite green on every endpoint
- [ ] No `dangerouslySetInnerHTML` without review annotation
- [ ] Secret scan clean; no `.env` in history
- [ ] Open-relay test rejected
- [ ] Rate limits verified on auth + export
- [ ] Restore from encrypted backup verified
- [ ] Dependency audit clean (or documented exceptions)
- [ ] CSRF + CSP verified in a browser
- [ ] Kill switch tested
