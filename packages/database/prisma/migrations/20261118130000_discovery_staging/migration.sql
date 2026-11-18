-- CreateEnum
CREATE TYPE "StagingStatus" AS ENUM ('PENDING', 'CREATED', 'MERGED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CandidateKind" ADD VALUE 'PHONE';
ALTER TYPE "CandidateKind" ADD VALUE 'CONTACT_FORM';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ExtractionCandidate" ADD COLUMN     "category" "ContactCategory",
ADD COLUMN     "crawlJobId" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "pageUrl" TEXT,
ADD COLUMN     "personName" TEXT;

-- CreateTable
CREATE TABLE "CompanyCandidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "runId" TEXT,
    "sourceRecordId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "registrationNumber" TEXT,
    "legalForm" TEXT,
    "description" TEXT,
    "countryIso2" TEXT,
    "regionName" TEXT,
    "cityName" TEXT,
    "postalCode" TEXT,
    "addressLine" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "industryLabel" TEXT,
    "industryCodes" JSONB NOT NULL DEFAULT '[]',
    "employeeRange" TEXT,
    "foundedYear" INTEGER,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "licence" TEXT,
    "status" "StagingStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "CompanyCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyCandidate_status_createdAt_idx" ON "CompanyCandidate"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyCandidate_projectId_status_idx" ON "CompanyCandidate"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCandidate_projectId_sourceId_sourceRecordId_key" ON "CompanyCandidate"("projectId", "sourceId", "sourceRecordId");

