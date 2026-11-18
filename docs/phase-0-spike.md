# Phase 0 — Proving Ground

**Duration:** 2 weeks · **Output:** a go/no-go decision, not a product.

The entire business case rests on one unproven claim: *public company websites contain enough accurate, legally usable business contact data to build a useful database without paid sources.* Phase 0 tests that claim cheaply, before any UI exists.

---

## 1. Questions to answer

| # | Question | How it is measured |
| --- | --- | --- |
| Q1 | How often does a company site expose at least one real business email? | companies with ≥1 extracted email / 50 |
| Q2 | How accurate is deterministic extraction? | hand-checked precision on a 25-email sample |
| Q3 | How many of those are actual contact routes vs junk? | role vs personal vs vendor/asset ratio |
| Q4 | How much does crawling cost in time and bandwidth? | pages, seconds, MB per company |
| Q5 | Where does extraction fail? | failure taxonomy per archetype |
| Q6 | Can we stay polite and unblocked? | blocks, 429s, robots denials |

---

## 2. Sample design

50 companies, deliberately unbalanced to expose failure modes:

| Archetype | Count | Why |
| --- | --- | --- |
| Small local business (SE/DE) | 10 | `Impressum` pages, often the richest source |
| Mid-market B2B SaaS | 10 | JS-heavy, footer-only contacts |
| Agency / consultancy | 10 | team pages with personal emails |
| Manufacturer / industrial | 10 | old HTML, PDF contact sheets |
| Professional services (law/accounting) | 5 | strict consent posture, good test of compliance gate |
| E-commerce | 5 | widget noise, `support@` / `noreply@` traps |

Exclude: anything behind a login, anything whose robots.txt disallows crawling, anything in a jurisdiction you are not prepared to process.

---

## 3. Protocol

### Week 1 — build the probe

1. `services/crawler` — minimal HTTPX fetch with the **real SSRF guard** and robots check (do not spike with an unsafe fetcher; you will reuse this code).
2. `services/extractor` — mailto + JSON-LD + visible-text regex, `SELECTOLAX` parsing, Pydantic candidate model.
3. `services/verifier` — syntax + DNS + MX only.
4. CLI:

```bash
python -m leadforge.probe run --domains tests/fixtures/phase0-domains.txt --out data/phase0/
python -m leadforge.probe report data/phase0/
```

5. Storage: files on disk (JSONL), no database. Throwaway by design.

### Week 2 — run, label, decide

1. Crawl all 50 (homepage + up to 5 likely contact pages, 2s delay).
2. Export candidate list; hand-label 25 emails: correct / wrong / junk.
3. Classify every failure by cause.
4. Write `docs/phase-0-findings.md` with tables and a recommendation.

---

## 4. Measurement sheet

| Company | URL | Pages | Emails found | Unique | Role | Personal | Vendor/junk | MX ok | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Summary rows:

```
companies_with_email / 50            = ___
total_unique_emails                  = ___
precision (25 sample)                = ___ / 25
median_pages_per_company             = ___
median_seconds_per_company           = ___
blocks / 429 / robots_denials        = ___ / ___ / ___
archetypes_with_zero_yield           = ___
```

---

## 5. Decision thresholds

| Outcome | Condition | Action |
| --- | --- | --- |
| **Go** | ≥ 15/50 companies with a usable email, precision ≥ 85% | proceed to Phase 1 as planned |
| **Conditional** | 8–14/50 or precision 70–85% | proceed, but add a structured-source adapter (registries/directories) to the critical path in Phase 3 |
| **Pivot** | < 8/50 or precision < 70% | stop. Re-scope to directory-first discovery, or narrow to a vertical where structured data exists |
| **Stop** | systematic blocks or legal ambiguity | do not build; revisit sourcing model |

Write the decision into `docs/decisions.md` as an ADR with the numbers attached.

---

## 6. What Phase 0 must not become

- A dashboard. No UI.
- A database schema. JSONL is enough.
- A general crawler. One process, sequential per domain.
- A data-quality crusade. Measure, do not perfect.
- A reason to skip safety. The SSRF guard and robots check are built here because they are reused verbatim later.
