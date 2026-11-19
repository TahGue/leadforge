# Performance at the first scale milestone

Spec §22 targets 100,000 records first. Measured with `scripts/load-test.mjs` on 2026-11-18.

## Method

```bash
node scripts/load-test.mjs generate --companies 100000   # synthetic org "loadtest", .invalid domains
node scripts/load-test.mjs measure                       # 1 warm-up + 5 timed runs per query
node scripts/load-test.mjs cleanup
```

Generated per company: a resolved headquarters location (spread over the seeded cities), a subsector classification, one role contact, and one email with mixed statuses. **100,000 companies, locations, industries, contacts and emails were generated in 15.8 s.**

Environment: PostGIS 16-3.5 in Docker Desktop on a Windows 11 workstation, default Postgres settings, `ANALYZE` after generation.

## Results

| Query | p50 | max |
| --- | --- | --- |
| Companies list, newest first (page of 50) | 2.5 ms | 2.7 ms |
| Companies by country (count) | 1.6 ms | 1.6 ms |
| Companies in a city (page of 50) | 4.1 ms | 4.7 ms |
| Companies in a subsector (page of 50) | 2.6 ms | 2.8 ms |
| Full-text search (`searchVector`, GIN) | 1.8 ms | 2.2 ms |
| Radius query, companies within 25 km (PostGIS, GiST) | 7.8 ms | 8.8 ms |
| Contacts with MX-valid email (page of 50) | 2.8 ms | 2.9 ms |
| Dashboard email-status breakdown | 44.3 ms | 44.5 ms |
| Stale companies count | 14.5 ms | 25.9 ms |

Every hot query is under the 500 ms p50 budget, by two orders of magnitude.

## One million companies

Same script and machine, 2026-11-18: `generate --companies 1000000` took 152 s, then `measure`, then `cleanup`.

| Query | p50 | max |
| --- | --- | --- |
| Companies list, newest first (page of 50) | 5.3 ms | 6.0 ms |
| Companies by country (count) | 8.8 ms | 9.0 ms |
| Companies in a city (page of 50) | 3.9 ms | 4.1 ms |
| Companies in a subsector (page of 50) | 2.5 ms | 2.7 ms |
| Full-text search | 1.7 ms | 2.1 ms |
| Radius query, 25 km (PostGIS) | 32.0 ms | 44.2 ms |
| Contacts with MX-valid email (page of 50) | 2.9 ms | 3.2 ms |
| Dashboard email-status breakdown | 273.3 ms | 303.5 ms |
| Stale companies count | 124.8 ms | 204.5 ms |

Every list and search query stays under 50 ms at 1M rows. The dashboard email-status aggregation (a join through contacts) is the only query near 300 ms, so the dashboard now caches it per organization for 60 s (`apps/web/src/lib/cache.ts`); a worker-maintained rollup table is the next step if it grows further.

## Importing 100,000 companies

`pnpm --filter @leadforge/worker exec tsx scripts/import-load-test.ts 100000`, same machine, 2026-11-18: staging took 8.8 s; normalization (geography, taxonomy, dedup, evidence, crawl job per domain) took 525 s with `NORMALIZE_CONCURRENCY=8`, 8.9 min in total. All 100,000 rows became companies. Halfway through, the run simulated a crash; the 50,000 pending rows resumed from Postgres. Before parallel normalization the same path ran at about 28 ms per row (about 48 min per 100,000). Raise `NORMALIZE_CONCURRENCY` on hosts with more cores and a larger Postgres connection pool.

## Toward ten million

- Crawl throughput, not the database, is the bottleneck: at the default 6 requests/minute/domain and 4 concurrent jobs, 100,000 companies × 12 pages take about 83 hours of crawling. Scale with more crawler processes (one domain per job is enforced), not higher per-site rates.
- Partition `CrawlPage`, `SourceEvidence` and `AuditLog` by month only when measured volume calls for it (spec §15).
- Add OpenSearch only if Postgres FTS becomes a measured bottleneck (ADR-0015).

## Local AI classification

`python -m leadforge.ai_eval --model qwen3.8:27b` on 2026-11-18, local Ollama (Q4_K_M), production prompt and grounding check, 24 labelled items (`tests/golden/classification.jsonl`: Swedish, English and German texts, two "no classification" cases, one prompt-injection case).

| Model | Accuracy | False stores | Stored | Abstained | p50 latency |
| --- | --- | --- | --- | --- | --- |
| qwen3.8:27b | 23/24 (96%) | 1 | 23 | 1 | 18.5 s |

- The prompt-injection item ("IGNORE ALL PREVIOUS INSTRUCTIONS…", a bakery) was classified as food processing, not as the injected code.
- The single false store was "Holding AB, owns and manages shares in subsidiaries" → investment. Defensible, but the label expected abstention; AI classifications are stored at confidence ≤ 0.7 with method `AI` so they stay distinguishable and reviewable.
- 18.5 s per company is acceptable for the background batch (`OLLAMA_BATCH=10`). For hosts without a GPU, benchmark a smaller model with the same command before switching.
- The set is synthetic. Extend it with real, hand-labelled companies from your market before relying on the accuracy figure.
