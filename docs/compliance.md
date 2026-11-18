# LeadForge — Compliance Model

> **Status of this document:** engineering requirements, not legal advice. Every jurisdiction profile ships as `DRAFT` and requires review by qualified counsel before real sending is enabled in that market. The rules encoded here are conservative defaults that may over-restrict; they must never under-restrict.

---

## 1. Three questions, never merged

Most lead tools conflate these. LeadForge keeps them separate in code, data, and UI:

| # | Question | Owner | Artifact |
| --- | --- | --- | --- |
| 1 | May we access and collect this page? | `sources` policy + crawler | `sources.permitted`, robots cache, fetch logs |
| 2 | May we store and process this personal data? | `lawful_basis_records` + `jurisdiction_profiles` | basis record, LIA, retention |
| 3 | May we send marketing to this address, now? | eligibility engine | `eligibility_decisions` |

A "yes" for #1 is not a "yes" for #2, and neither is a "yes" for #3. **Discovering a public email never authorizes sending.**

---

## 2. Data classes

| Class | Examples | Handling |
| --- | --- | --- |
| Business identity | company name, domain, industry, country | low sensitivity, retain while relevant |
| Business contact | generic inbox, role, office city | moderate; purpose limitation |
| Personal contact | named individual, title, work email | personal data; basis required; minimization |
| Sensitive/special category | health, religion, politics, union, biometric | **not collected**; extractor drops if detected |
| Children | school/minor-related contacts | **not collected**; domain blocklist |
| Free-text page content | raw HTML artifacts | retained short-term, access-controlled, not exposed to end users |

---

## 3. Collection rules

- Only publicly accessible pages. No authentication, no paywall bypass, no `noindex`-only content scraping at scale.
- Honor `robots.txt` (including `Crawl-delay`), site terms, and rate limits.
- Identify the crawler honestly: `LeadForgeBot/0.1 (+https://<host>/bot)` with a contact page.
- Source registry gate: `sources.permitted = false` by default; enabling requires `tos_url`, `tos_reviewed_at`, `reviewed_by`.
- No collection from sources whose terms prohibit automated collection. If terms are ambiguous, the source stays disabled.
- No purchase or ingestion of leaked/scraped third-party datasets.
- Data minimization at extraction time: no phone numbers, home addresses, personal social profiles, or free-text biographies in v1.

---

## 4. Lawful basis and purpose

For personal data, exactly one recorded basis per (email, purpose, jurisdiction):

| Basis | When used | Required evidence |
| --- | --- | --- |
| `CONSENT` | affirmative opt-in captured | consent record with source URL, timestamp, wording |
| `LEGITIMATE_INTEREST` | B2B outreach to role-relevant business contacts, where permitted | documented LIA: necessity, balancing, safeguards, opt-out |
| `CONTRACT` | existing customer relationship | contract reference |
| `LEGAL_OBLIGATION` | required communications | legal reference |

**LIA template** (stored in `lawful_basis_records.assessment`):

1. Purpose test — what business interest, whose benefit?
2. Necessity test — why is this data/contact needed, is there a less intrusive route?
3. Balancing test — reasonable expectations of the recipient, sensitivity, relationship, impact of an unwanted email.
4. Safeguards — relevance filtering, frequency caps, easy opt-out, suppression, retention.
5. Outcome + reviewer + date + review date.

**Transparency:** where personal data is obtained indirectly, GDPR-style regimes require informing the subject within a defined window (commonly one month), with limited exceptions. v1 ships a privacy notice page and a per-domain "source of data" disclosure endpoint used in outreach footers; the operational notice workflow is a v2 item (see `open-questions.md`).

---

## 5. The eligibility engine

### 5.1 API

```
POST /api/v1/eligibility/evaluate
{ "emailId": "...", "campaignId": "...", "purpose": "MARKETING" }

200 {
  "outcome": "ELIGIBLE" | "NOT_ELIGIBLE" | "NEEDS_REVIEW" |
             "SUPPRESSED" | "UNKNOWN_JURISDICTION",
  "ruleSetVersion": "se-2026.1",
  "reasons": [{ "code": "NO_LAWFUL_BASIS", "message": "...", "rule": "SE-19" }],
  "requiredActions": ["RECORD_CONSENT"],
  "expiresAt": "2026-11-19T10:00:00Z"
}
```

### 5.2 Evaluation order (first match wins)

| # | Check | Fail outcome |
| --- | --- | --- |
| 1 | Global suppression (unsubscribe, complaint, legal objection) | `SUPPRESSED` |
| 2 | Org suppression / legal hold | `SUPPRESSED` |
| 3 | Email status `UNDELIVERABLE` or verification expired | `NOT_ELIGIBLE` |
| 4 | Jurisdiction resolvable and profile `APPROVED` | `UNKNOWN_JURISDICTION` |
| 5 | Recipient entity type known (corporate vs individual) | `NEEDS_REVIEW` |
| 6 | Regime requires consent → consent record present & not withdrawn | `NOT_ELIGIBLE` |
| 7 | Legitimate-interest regime → LIA present, valid, not objected | `NOT_ELIGIBLE` / `NEEDS_REVIEW` |
| 8 | Sender identity + postal address configured for campaign | `NOT_ELIGIBLE` |
| 9 | Unsubscribe mechanism configured and token signing key present | `NOT_ELIGIBLE` |
| 10 | Frequency cap / recent-contact cooldown | `NOT_ELIGIBLE` |
| 11 | Segment purpose matches campaign purpose | `NEEDS_REVIEW` |
| — | all pass | `ELIGIBLE` (expires in 24h) |

### 5.3 Decision records

- Append-only. Each row contains `rule_set_version`, `context_hash` (hash of the inputs that mattered), `reasons`, `expires_at`.
- A decision older than 24h is invalid; campaigns re-evaluate immediately before each batch and immediately before each send.
- Decisions are never edited; a new decision supersedes via `superseded_by`.

### 5.4 UI obligations

- "Why blocked?" panel listing each failed rule in plain language.
- Bulk preview before a campaign can be scheduled: counts per outcome.
- A campaign cannot move to `SCHEDULED` if any recipient is not `ELIGIBLE` at that moment — ineligible recipients are excluded, not silently attempted.

---

## 6. Jurisdiction profiles

Profiles are versioned JSON artifacts (stored in `jurisdiction_profiles.rules`), not code. Shape:

```json
{
  "code": "SE",
  "version": "2026.1",
  "status": "DRAFT",
  "regime": "GDPR + national e-marketing law",
  "marketing_email": {
    "to_individual": { "requires": "PRIOR_CONSENT", "existing_customer_exception": true },
    "to_corporate": { "requires": "CONSENT_OR_LEGITIMATE_INTEREST", "opt_out_required": true }
  },
  "sender_requirements": ["IDENTITY", "POSTAL_ADDRESS", "UNSUBSCRIBE_LINK"],
  "unsubscribe": { "max_days_to_honor": 0, "one_click_required": true },
  "retention_months": 24,
  "notes": "Draft — requires counsel sign-off before enabling sending."
}
```

### 6.1 Draft matrix (engineering assumptions — verify with counsel)

| Region | Regime sketch | Prior consent for individuals? | Corporate recipient treatment | Notable mechanics |
| --- | --- | --- | --- | --- |
| Sweden (SE) | GDPR + Marketing Act | Generally yes, narrow existing-customer exception | Opt-out required; sender must provide a valid stop address | strict consent posture |
| EU/EEA (generic) | GDPR + ePrivacy national implementations | Usually yes (varies by member state) | varies; several states treat business email strictly | transparency + objection rights |
| Germany (DE) | GDPR + UWG | Yes, including B2B in practice | prior express consent expected | very strict; default deny |
| UK (GB) | UK GDPR + PECR | Yes for individual subscribers | corporate subscribers generally opt-out; sole traders/partnerships treated as individuals | PECR distinction is decisive |
| US (US) | CAN-SPAM | No (opt-out regime) | applies to commercial email including B2B | physical address, honest headers, working unsubscribe |
| Canada (CA) | CASL | Generally yes; limited implied consent (e.g. published business address under conditions) | applies | identification + unsubscribe |
| Australia (AU) | Spam Act | Consent (express or inferred) | applies | functional unsubscribe, identification |

The code should treat every row as data, not as branches in TypeScript.

### 6.2 Profile lifecycle

```
DRAFT → APPROVED (counsel sign-off recorded) → RETIRED
```

Sending in a country is disabled unless an `APPROVED` profile exists for the resolved jurisdiction. Unresolved → `UNKNOWN_JURISDICTION` → blocked.

---

## 7. Suppression

- **Global list**: unsubscribe, complaint, hard bounce, legal objection — applies to every org on the instance.
- **Org list**: manual do-not-contact, competitor hold, customer request.
- **Domain-level suppression**: e.g. a law firm that sent a cease-and-desist.
- Checked at: list build, campaign scheduling, each send batch, and each individual send. A row inserted mid-campaign stops the very next send.
- Unsubscribe is immediate (no batch window), tokenized, single-click, unauthenticated but signed, idempotent, and does not require login.
- Re-importing a suppressed address keeps it suppressed — imports must join against suppression and mark, not overwrite.

---

## 8. Data subject rights (v1, manual + audited)

| Request | Workflow | SLA (default) |
| --- | --- | --- |
| Access | search by email/domain across companies, contacts, evidence; export JSON | 30 days |
| Erasure | delete/hash personal fields, retain suppression hash, record what was removed | 30 days |
| Objection to marketing | insert global suppression immediately, mark basis record | immediate |
| Rectification | edit + evidence note | 30 days |

`data_subject_requests` records type, status and due date. In v1 the workflow is executed manually by an operator with full audit logging; automated discovery/export tooling is a v2 item. Suppression records survive erasure as a minimal hash to avoid re-contact.

---

## 9. Retention

| Data | Retention | Basis |
| --- | --- | --- |
| Raw page artifacts | 90 days | operational necessity |
| Extraction candidates | 180 days | quality review |
| Contact + company records | while relevant + 24 months stale | legitimate interest / contract |
| Verification history | 24 months | audit |
| Consent records | life of processing + 3 years | proof |
| Suppression | indefinite (minimal hash) | legal obligation |
| Audit logs | 24 months | security |
| Campaign events | 24 months | analytics/abuse defense |

Purge jobs are scheduled, dry-runnable, audited, and skipped for records under legal hold or open DSRs.

---

## 10. Product-level guardrails

- No "send to all" button. Campaigns require: segment → eligibility preview → human approval (four-eyes when a second user exists) → schedule.
- Default frequency cap: max 1 marketing email per address per 30 days, max 4 per year (configurable down, not up without an explicit setting change).
- Every outbound message carries: sender legal identity, postal address, unsubscribe link, and a one-line "why you received this" (source category).
- Test mode sends only to allowlisted internal addresses; production sending requires a completed warmup state.
- Kill switch: one setting halts all outbound mail instance-wide.

---

## 11. Compliance change management

1. Counsel reviews a profile → status `APPROVED` with `approved_by`, `approved_at`.
2. Rule changes create a new `version`; old decisions retain their `rule_set_version`.
3. Re-evaluation job flags recipients whose decision was made under a retired rule set.
4. Every compliance-relevant code change requires: unit tests for the rule, a decision-record test, and a changelog entry in `docs/compliance-changelog.md`.
