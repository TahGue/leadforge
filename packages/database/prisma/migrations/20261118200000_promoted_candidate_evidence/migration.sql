-- Gate G5: every promoted extraction candidate keeps the page it came from.
-- Prisma does not model CHECK constraints, so this lives only in SQL.
ALTER TABLE "ExtractionCandidate"
  ADD CONSTRAINT "ExtractionCandidate_promoted_has_evidence"
  CHECK (status <> 'PROMOTED' OR "pageUrl" IS NOT NULL);
