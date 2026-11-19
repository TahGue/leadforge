# LeadForge — Data model

The physical schema is [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma). This document maps the logical tables in spec §15 onto it and states the rules that keep it consistent.

## Spec tables → schema

| Spec §15 table | Model(s) | Notes |
| --- | --- | --- |
| `users` | `User`, `Membership`, `Session`, `ApiKey` | Roles per organization (OWNER, ADMIN, ANALYST, VIEWER); Argon2id hashes |
| `discovery_projects` | `DiscoveryProject` | Typed columns plus `settings` JSON validated by `discoveryProjectSettings` (Zod) |
| `discovery_locations` | `DiscoveryLocation` | Level CONTINENT/COUNTRY/REGION/CITY/POSTAL/POINT, include/exclude, radius, generated `geog` |
| `discovery_industry_filters` | `DiscoveryIndustryFilter` | include/exclude, `includeDescendants` |
| `discovery_keywords` | `DiscoveryKeyword` | type GENERAL/PRODUCT/SERVICE/TECHNOLOGY/DOMAIN |
| `discovery_source_selections` | `DiscoverySourceSelection` | per-source configuration (e.g. domain list) |
| — (stages 3–5) | `DiscoveryRun`, `CompanyCandidate`, `ProjectCompany` | One run per source; staged raw records; project results |
| `companies` | `Company` | `normalizedName`, `registrationNumber`, website facts, `confidenceDetail`, `tags`, generated `searchVector` |
| `company_locations` | `CompanyLocation` | Geography IDs, `resolution` (RESOLVED/UNRESOLVED/AMBIGUOUS), generated `geog` |
| `company_industries` | `CompanyIndustry` | primary flag, confidence, method (MANUAL/IMPORT/ALIAS/SOURCE/KEYWORD/AI), evidence |
| `contacts` | `Contact`, `EmailAddress`, `ContactEmail` | Category separate from type; phone (E.164), form URL, role vs named |
| `contact_evidence` | `SourceEvidence` | Page URL, method, snippet, artifact, content hash, observed time |
| `sources` | `Source` | Policy fields, `policyStatus`, `policyVersion`, adapter, config |
| `source_observations` | `SourceObservation` | Field-level values from source records with licence and policy version |
| `crawl_jobs` / `crawl_pages` | `CrawlJob`, `CrawlPage`, `FetchArtifact` | Job metrics and policy stops; per-page status; raw body by reference |
| `email_verifications` | `EmailVerification` | Separate `syntaxStatus`, `dnsStatus`, `mxStatus`, `providerCategory` |
| `suppressions` | `SuppressionEntry` | Address, or domain-wide as `*@domain`; never deleted by retention |
| `audit_logs` | `AuditLog` | Actor (user or API key), action, entity, metadata |
| geography | `Continent`, `Country`, `AdminRegion`, `City`, `PostalArea`, `GeoAlias`, `GeoImportBatch` | Stable external IDs, licence per import batch |
| taxonomy | `IndustryTaxonomyVersion`, `Industry`, `IndustryExternalCode`, `IndustryAlias` | Versioned; NACE Rev. 2 mappings |
| quality | `CompanyDuplicateCandidate`, `SavedSegment` | Human-decided merges; saved views |
| campaigns (Phase 9) | `Campaign`, `CampaignRecipient`, `CampaignSend`, `EmailEvent`, `EligibilityDecision`, `JurisdictionProfile`, `LawfulBasisRecord`, `ConsentRecord`, `UnsubscribeToken` | Frozen behind `FEATURE_CAMPAIGNS` |

## Invariants

1. **No fabricated contacts.** Contacts come only from page evidence or manual entry with a source URL; there is no pattern-guessing table.
2. **Provenance.** Every contact has a `SourceEvidence` row or a `sourceUrl`; every source-supplied company field has a `SourceObservation`.
3. **Merge rules.** Automatic merges happen only on registrable domain or registration number. Name and country matches become `CompanyDuplicateCandidate`.
4. **Fill, don't overwrite.** A new source fills empty company fields; it never replaces a value already present.
5. **Geography by ID.** Locations reference `City`/`AdminRegion`/`Country` IDs. Free text stays in `rawText` with `resolution = UNRESOLVED`.
6. **Policy versioning.** Changing a source's policy bumps `policyVersion`; observations record the version in force.
7. **Suppression wins.** Checked at import (domain), contact creation, crawl promotion and verification.

## Migrations

- One folder per change in `packages/database/prisma/migrations/`, applied with `prisma migrate deploy`. Each SQL file starts with a rollback note.
- Generate with `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel packages/database/prisma/schema.prisma --script`, then edit for data moves.
- Generated columns (`geog`, `searchVector`) are declared `Unsupported(...)` in Prisma and created with `GENERATED ALWAYS … STORED` in SQL. Prisma diffs propose `DROP DEFAULT` for them: delete those lines. `scripts/check-schema-drift.mjs` (run in CI) ignores exactly those and fails on anything else.
- Reference data is loaded by `packages/database/prisma/reference.mjs` (idempotent; the compose `migrate` service runs it after migrations). Countries and continents are inserted by the realign migration because a foreign key depends on them.

| Migration | Change |
| --- | --- |
| `20260101000000_init` | v0 schema |
| `20261118120000_realign_discovery` | PostGIS, geography, taxonomy, discovery filters, runs, crawl jobs/pages, policy fields, verification statuses; data moves from v0 columns |
| `20261118130000_discovery_staging` | `CompanyCandidate`, phone/form candidates, tags |
| `20261118140000_company_search` | Generated full-text `searchVector` + GIN index |
