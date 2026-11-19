-- Staged company records and domain events lacked foreign keys, so deleting an
-- organization or project left them behind. Orphaned PENDING rows also starved
-- the normalization sweep (it reads the oldest pending rows first).

-- Remove rows that already point at deleted parents, so the constraints apply cleanly.
DELETE FROM "CompanyCandidate" c
WHERE NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = c."organizationId")
   OR NOT EXISTS (SELECT 1 FROM "DiscoveryProject" p WHERE p.id = c."projectId")
   OR NOT EXISTS (SELECT 1 FROM "Source" s WHERE s.id = c."sourceId");
UPDATE "CompanyCandidate" c SET "runId" = NULL
WHERE c."runId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "DiscoveryRun" r WHERE r.id = c."runId");
UPDATE "CompanyCandidate" c SET "companyId" = NULL
WHERE c."companyId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Company" co WHERE co.id = c."companyId");
DELETE FROM "DomainEvent" e
WHERE e."organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = e."organizationId");

-- AddForeignKey
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCandidate" ADD CONSTRAINT "CompanyCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCandidate" ADD CONSTRAINT "CompanyCandidate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DiscoveryProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCandidate" ADD CONSTRAINT "CompanyCandidate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCandidate" ADD CONSTRAINT "CompanyCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCandidate" ADD CONSTRAINT "CompanyCandidate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes for the cascades and the normalization sweep's project filter.
CREATE INDEX IF NOT EXISTS "CompanyCandidate_organizationId_idx" ON "CompanyCandidate"("organizationId");
