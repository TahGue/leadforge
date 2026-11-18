# LeadForge — Open Questions

Decisions the plan cannot make alone. Each has a recommendation so work can proceed with a default.

| # | Question | Why it matters | Recommendation | Blocking |
| --- | --- | --- | --- | --- |
| Q1 | Which countries are the first three jurisdiction profiles? | Drives profile authoring, legal review cost, and crawl targets | Pick where you actually sell: likely SE + one more EU state + US or UK | Phase 7 |
| Q2 | Single-org or multi-tenant at launch? | Schema is org-scoped either way; UI/auth differ | Single-org (ADR-0018) | Phase 1 |
| Q3 | Sending domain and who controls PTR? | Deliverability is unrecoverable if wrong | Dedicated `outreach.` subdomain on a domain you control; VPS with PTR control | Phase 9 |
| Q4 | Which public registry or open dataset first? (Bolagsverket, Companies House, Brønnøysund…) | Registries are high-precision and legally clean | **Built 2026-11-18:** the `open_dataset` adapter reads any registry export. Remaining: choose the dataset, check its licence, approve the source | Spec Phase 4 data |
| Q5 | Monthly infrastructure budget ceiling? | Sizing and offsite backup choices | Assume ≤ €100/month for v1 single-host + backup | Phase 1 |
| Q6 | MCP/agent access in v1 or v2? | Changes API/auth design if early | v2; keep API token auth clean now | Phase 10 |
| Q7 | Is "opened email" tracking acceptable? | Privacy-sensitive, hurts deliverability, often inaccurate | Off by default; if ever added, make it per-campaign opt-in | Phase 8 |
| Q8 | Who performs legal review, and at what cost? | Profiles cannot be APPROVED without it | Budget one review cycle per country before sending | Phase 7/9 |
| Q9 | Data residency: must all data stay in one country? | Affects hosting and backups | Assume EU hosting for EU data | Phase 1 |
| Q10 | Is there a commercial intent (sell access) or personal use? | Changes ToS, tenancy, billing, DPA obligations | Assume personal/small-team use for v1 | Phase 1 |
| Q11 | What is the acceptable review workload? | Determines auto-promotion thresholds | **Resolved 2026-11-18:** only deterministic (mailto/tel/JSON-LD), on-domain, role-based contacts and contact forms are auto-promoted (`CRAWLER_AUTO_PROMOTE_CONFIDENCE`); named people always go to review | — |
| Q12 | Should free-provider emails (gmail.com etc.) be stored at all? | They are personal data with weak B2B relevance | **Resolved 2026-11-18:** kept as review candidates only, never auto-promoted; projects exclude them by default | — |
| Q13 | Which map tile source? | Public OSM tiles are not for application traffic (spec 21) | Self-host (e.g. Protomaps PMTiles) or a licensed provider; set `NEXT_PUBLIC_MAP_STYLE_URL` | Explorer basemap |
| Q14 | Which local model for classification? | Accuracy, speed and hardware | **Resolved 2026-11-18 (ADR-0025):** `qwen3.8:27b`, 96% on the bundled set; re-benchmark smaller models with `leadforge.ai_eval` on smaller hosts | — |
| Q15 | Which markets need full GeoNames coverage? | City-level targeting outside the seed countries | Import `cities1000` for the countries you sell in (`scripts/import-geonames.mjs`) | City scopes outside SE/NO/DK/FI/DE/GB |

---

## How questions get resolved

1. Answer recorded here with a date and a link to the resulting ADR (if architectural).
2. If the answer changes scope, amend `MEGA-PLAN.md` through an ADR and update `backlog.md`.
3. Anything affecting sending is additionally gated by a recorded legal sign-off.
