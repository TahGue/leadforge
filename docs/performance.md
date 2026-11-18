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

## Toward one million

- The heaviest query is the dashboard's email-status aggregation (a join through contacts). At 1M rows, expect roughly 0.5 s: cache it per minute, or keep a rollup table updated by the worker.
- Crawl throughput, not the database, is the bottleneck: at the default 6 requests/minute/domain and 4 concurrent jobs, 100,000 companies × 12 pages take about 83 hours of crawling. Scale with more crawler processes (one domain per job is enforced), not higher per-site rates.
- Partition `CrawlPage`, `SourceEvidence` and `AuditLog` by month only when measured volume calls for it (spec §15).
- Add OpenSearch only if Postgres FTS becomes a measured bottleneck (ADR-0015).
