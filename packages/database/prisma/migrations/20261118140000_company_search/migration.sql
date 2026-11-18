-- Full-text search over companies (spec section 8: PostgreSQL FTS first, ADR-0015).
-- Rollback: DROP INDEX "Company_searchVector_idx"; ALTER TABLE "Company" DROP COLUMN "searchVector";

ALTER TABLE "Company" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("legalName", '') || ' ' || coalesce("description", '') || ' ' || coalesce("industry", ''))
) STORED;

CREATE INDEX "Company_searchVector_idx" ON "Company" USING GIN ("searchVector");
