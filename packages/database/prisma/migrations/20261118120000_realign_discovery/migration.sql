-- Realign the schema with specification v1.0 (ADR-0020).
--
-- Rollback: this migration is not reversible in place. Restore the pre-migration
-- backup (scripts/backup.sh) to roll back. Data moved here:
--   Company.city/region      -> CompanyLocation.rawText (resolution = UNRESOLVED)
--   DiscoveryProject.criteria -> DiscoveryLocation / DiscoveryKeyword, settings.legacyCriteria
--   DiscoveryProject.budget   -> maxCompanies / maxPagesPerCompany / maxCrawlDepth
--   CrawlTarget               -> CrawlJob
--   EmailPattern              -> dropped (pattern guessing is a non-goal, spec section 2)

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE "_realign_company_loc" AS
  SELECT "id", UPPER(TRIM("countryCode")) AS "countryCode", "region", "city"
  FROM "Company" WHERE "region" IS NOT NULL OR "city" IS NOT NULL;
CREATE TABLE "_realign_project" AS
  SELECT "id", "status", "criteria", "budget" FROM "DiscoveryProject";
CREATE TABLE "_realign_crawl" AS
  SELECT "id", "organizationId", "projectId", "sourceId", "domainId", "url", "urlHash", "priority", "depth",
         "status"::text AS "status", "attempts", "lastError", "scheduledFor", "createdAt", "updatedAt"
  FROM "CrawlTarget";
UPDATE "Company" SET "countryCode" = UPPER(TRIM("countryCode")) WHERE "countryCode" IS NOT NULL;

-- CreateEnum
CREATE TYPE "CrawlJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'READY', 'QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "GeographicMode" AS ENUM ('CITY', 'REGION', 'COUNTRY', 'CONTINENT', 'WORLDWIDE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "FilterMode" AS ENUM ('INCLUDE', 'EXCLUDE');

-- CreateEnum
CREATE TYPE "GeoLevel" AS ENUM ('CONTINENT', 'COUNTRY', 'REGION', 'CITY', 'POSTAL', 'POINT');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('UNREVIEWED', 'APPROVED', 'RESTRICTED', 'DENIED');

-- CreateEnum
CREATE TYPE "OperatingStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'NEWLY_REGISTERED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('UNKNOWN', 'REACHABLE', 'UNREACHABLE', 'ABSENT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('UNREVIEWED', 'NEEDS_REVIEW', 'REVIEWED');

-- CreateEnum
CREATE TYPE "ContactCategory" AS ENUM ('GENERAL', 'SALES', 'PROCUREMENT', 'MANAGEMENT', 'PRESS', 'SUPPORT', 'CAREERS', 'NAMED', 'OTHER');

-- CreateEnum
CREATE TYPE "SyntaxStatus" AS ENUM ('UNKNOWN', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "DnsStatus" AS ENUM ('UNKNOWN', 'VALID', 'NXDOMAIN', 'ERROR');

-- CreateEnum
CREATE TYPE "MxStatus" AS ENUM ('UNKNOWN', 'VALID', 'MISSING', 'FALLBACK_A', 'ERROR');

-- CreateEnum
CREATE TYPE "ProviderCategory" AS ENUM ('BUSINESS', 'FREE_MAIL', 'DISPOSABLE', 'ROLE_BASED');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('OPEN', 'MERGED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RunJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'BLOCKED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "CrawlTarget" DROP CONSTRAINT "CrawlTarget_domainId_fkey";

-- DropForeignKey
ALTER TABLE "CrawlTarget" DROP CONSTRAINT "CrawlTarget_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "CrawlTarget" DROP CONSTRAINT "CrawlTarget_projectId_fkey";

-- DropForeignKey
ALTER TABLE "CrawlTarget" DROP CONSTRAINT "CrawlTarget_sourceId_fkey";

-- DropIndex
DROP INDEX "Company_organizationId_name_countryCode_key";

-- AlterTable
ALTER TABLE "Company" DROP COLUMN "city",
DROP COLUMN "region",
ADD COLUMN     "confidenceDetail" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "hasCareersPage" BOOLEAN,
ADD COLUMN     "hasContactPage" BOOLEAN,
ADD COLUMN     "httpsEnabled" BOOLEAN,
ADD COLUMN     "lastCrawledAt" TIMESTAMP(3),
ADD COLUMN     "legalForm" TEXT,
ADD COLUMN     "normalizedName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "operatingStatus" "OperatingStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "ownership" TEXT,
ADD COLUMN     "primaryLanguage" TEXT,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "socialProfiles" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "technologies" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "websiteStatus" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "category" "ContactCategory" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "contactFormUrl" TEXT,
ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "isRoleBased" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "phoneE164" TEXT,
ADD COLUMN     "phoneRaw" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "sourceUrl" TEXT;

-- AlterTable
ALTER TABLE "DiscoveryProject" DROP COLUMN "budget",
DROP COLUMN "criteria",
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "geographicMode" "GeographicMode" NOT NULL DEFAULT 'COUNTRY',
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "maxCompanies" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "maxCrawlDepth" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "maxPagesPerCompany" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "startedAt" TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "EmailAddress" DROP COLUMN "patternInferred";

-- AlterTable
ALTER TABLE "EmailVerification" ADD COLUMN     "dnsStatus" "DnsStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "mxStatus" "MxStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "providerCategory" "ProviderCategory" NOT NULL DEFAULT 'BUSINESS',
ADD COLUMN     "syntaxStatus" "SyntaxStatus" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "adapter" TEXT,
ADD COLUMN     "attribution" TEXT,
ADD COLUMN     "automatedAccessAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commercialReuseAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "licenceName" TEXT,
ADD COLUMN     "licenceUrl" TEXT,
ADD COLUMN     "permittedUse" TEXT,
ADD COLUMN     "policyStatus" "PolicyStatus" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN     "policyVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "rateLimitJson" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "retentionDays" INTEGER;

-- DropTable
DROP TABLE "CrawlTarget";

-- DropTable
DROP TABLE "EmailPattern";

-- DropEnum
DROP TYPE "CrawlTargetStatus";

-- CreateTable
CREATE TABLE "CrawlJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "companyId" TEXT,
    "sourceId" TEXT,
    "domainId" TEXT,
    "rootUrl" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "status" "CrawlJobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "maxPages" INTEGER NOT NULL DEFAULT 12,
    "maxDepth" INTEGER NOT NULL DEFAULT 2,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "pagesSkipped" INTEGER NOT NULL DEFAULT 0,
    "bytesDownloaded" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "policyStopReason" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextRetryAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlPage" (
    "id" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "pageKind" TEXT NOT NULL DEFAULT 'OTHER',
    "httpStatus" INTEGER,
    "contentType" TEXT,
    "contentHash" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "bytesReceived" INTEGER NOT NULL DEFAULT 0,
    "renderMode" TEXT NOT NULL DEFAULT 'HTTP',
    "parseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "fetchArtifactId" TEXT,

    CONSTRAINT "CrawlPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoImportBatch" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "fileName" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Continent" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "geonameId" INTEGER,

    CONSTRAINT "Continent_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Country" (
    "iso2" TEXT NOT NULL,
    "iso3" TEXT,
    "isoNumeric" INTEGER,
    "name" TEXT NOT NULL,
    "continentCode" TEXT NOT NULL,
    "capital" TEXT,
    "population" BIGINT,
    "geonameId" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("iso2")
);

-- CreateTable
CREATE TABLE "AdminRegion" (
    "id" TEXT NOT NULL,
    "countryIso2" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isoCode" TEXT,
    "name" TEXT NOT NULL,
    "asciiName" TEXT,
    "geonameId" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "countryIso2" TEXT NOT NULL,
    "regionId" TEXT,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asciiName" TEXT NOT NULL,
    "geonameId" INTEGER,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "geog" geography(Point, 4326) GENERATED ALWAYS AS (CASE WHEN "latitude" IS NULL OR "longitude" IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography END) STORED,
    "population" INTEGER,
    "timezone" TEXT,
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostalArea" (
    "id" TEXT NOT NULL,
    "countryIso2" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "regionId" TEXT,
    "cityId" TEXT,
    "placeName" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "importBatchId" TEXT,

    CONSTRAINT "PostalArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoAlias" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "language" TEXT,

    CONSTRAINT "GeoAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "isHeadquarters" BOOLEAN NOT NULL DEFAULT false,
    "addressLine" TEXT,
    "postalCode" TEXT,
    "rawText" TEXT,
    "countryIso2" TEXT,
    "regionId" TEXT,
    "cityId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geog" geography(Point, 4326) GENERATED ALWAYS AS (CASE WHEN "latitude" IS NULL OR "longitude" IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography END) STORED,
    "sourceId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "resolution" TEXT NOT NULL DEFAULT 'UNRESOLVED',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndustryTaxonomyVersion" (
    "id" TEXT NOT NULL,
    "taxonomy" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndustryTaxonomyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Industry" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndustryExternalCode" (
    "id" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "schemeVersion" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "IndustryExternalCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndustryAlias" (
    "id" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',

    CONSTRAINT "IndustryAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyIndustry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "sourceId" TEXT,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyIndustry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryLocation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "mode" "FilterMode" NOT NULL DEFAULT 'INCLUDE',
    "level" "GeoLevel" NOT NULL,
    "continentCode" TEXT,
    "countryIso2" TEXT,
    "regionId" TEXT,
    "cityId" TEXT,
    "postalAreaId" TEXT,
    "postalPrefix" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geog" geography(Point, 4326) GENERATED ALWAYS AS (CASE WHEN "latitude" IS NULL OR "longitude" IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography END) STORED,
    "radiusKm" DOUBLE PRECISION,
    "includeNearby" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DiscoveryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryIndustryFilter" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "mode" "FilterMode" NOT NULL DEFAULT 'INCLUDE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "includeDescendants" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DiscoveryIndustryFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryKeyword" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "keywordType" TEXT NOT NULL DEFAULT 'GENERAL',
    "mode" "FilterMode" NOT NULL DEFAULT 'INCLUDE',
    "language" TEXT,

    CONSTRAINT "DiscoveryKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoverySourceSelection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "configuration" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "DiscoverySourceSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "RunJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "query" JSONB NOT NULL DEFAULT '{}',
    "candidatesFound" INTEGER NOT NULL DEFAULT 0,
    "companiesCreated" INTEGER NOT NULL DEFAULT 0,
    "companiesMatched" INTEGER NOT NULL DEFAULT 0,
    "policyStopReason" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextRetryAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCompany" (
    "projectId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "discoveredVia" TEXT NOT NULL DEFAULT 'SOURCE',
    "sourceId" TEXT,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectCompany_pkey" PRIMARY KEY ("projectId","companyId")
);

-- CreateTable
CREATE TABLE "SourceObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "companyId" TEXT,
    "discoveryRunId" TEXT,
    "sourceRecordId" TEXT,
    "fieldName" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "licence" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawArtifactId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyDuplicateCandidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyAId" TEXT NOT NULL,
    "companyBId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '[]',
    "status" "DuplicateStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyDuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSegment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrawlJob_organizationId_status_priority_scheduledFor_idx" ON "CrawlJob"("organizationId", "status", "priority", "scheduledFor");

-- CreateIndex
CREATE INDEX "CrawlJob_status_scheduledFor_idx" ON "CrawlJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "CrawlJob_projectId_status_idx" ON "CrawlJob"("projectId", "status");

-- CreateIndex
CREATE INDEX "CrawlJob_companyId_idx" ON "CrawlJob"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlJob_projectId_urlHash_key" ON "CrawlJob"("projectId", "urlHash");

-- CreateIndex
CREATE INDEX "CrawlPage_crawlJobId_fetchedAt_idx" ON "CrawlPage"("crawlJobId", "fetchedAt");

-- CreateIndex
CREATE INDEX "CrawlPage_contentHash_idx" ON "CrawlPage"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Continent_geonameId_key" ON "Continent"("geonameId");

-- CreateIndex
CREATE UNIQUE INDEX "Country_iso3_key" ON "Country"("iso3");

-- CreateIndex
CREATE UNIQUE INDEX "Country_geonameId_key" ON "Country"("geonameId");

-- CreateIndex
CREATE INDEX "Country_continentCode_idx" ON "Country"("continentCode");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRegion_geonameId_key" ON "AdminRegion"("geonameId");

-- CreateIndex
CREATE INDEX "AdminRegion_isoCode_idx" ON "AdminRegion"("isoCode");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRegion_countryIso2_code_key" ON "AdminRegion"("countryIso2", "code");

-- CreateIndex
CREATE UNIQUE INDEX "City_externalId_key" ON "City"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "City_geonameId_key" ON "City"("geonameId");

-- CreateIndex
CREATE INDEX "City_countryIso2_asciiName_idx" ON "City"("countryIso2", "asciiName");

-- CreateIndex
CREATE INDEX "City_regionId_idx" ON "City"("regionId");

-- CreateIndex
CREATE INDEX "City_population_idx" ON "City"("population" DESC);

-- CreateIndex
CREATE INDEX "City_geog_idx" ON "City" USING GIST ("geog");

-- CreateIndex
CREATE UNIQUE INDEX "PostalArea_countryIso2_code_key" ON "PostalArea"("countryIso2", "code");

-- CreateIndex
CREATE INDEX "GeoAlias_normalized_entityType_idx" ON "GeoAlias"("normalized", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "GeoAlias_entityType_entityId_normalized_key" ON "GeoAlias"("entityType", "entityId", "normalized");

-- CreateIndex
CREATE INDEX "CompanyLocation_companyId_idx" ON "CompanyLocation"("companyId");

-- CreateIndex
CREATE INDEX "CompanyLocation_countryIso2_regionId_cityId_idx" ON "CompanyLocation"("countryIso2", "regionId", "cityId");

-- CreateIndex
CREATE INDEX "CompanyLocation_cityId_idx" ON "CompanyLocation"("cityId");

-- CreateIndex
CREATE INDEX "CompanyLocation_resolution_idx" ON "CompanyLocation"("resolution");

-- CreateIndex
CREATE INDEX "CompanyLocation_geog_idx" ON "CompanyLocation" USING GIST ("geog");

-- CreateIndex
CREATE UNIQUE INDEX "IndustryTaxonomyVersion_taxonomy_version_key" ON "IndustryTaxonomyVersion"("taxonomy", "version");

-- CreateIndex
CREATE INDEX "Industry_parentId_idx" ON "Industry"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Industry_versionId_code_key" ON "Industry"("versionId", "code");

-- CreateIndex
CREATE INDEX "IndustryExternalCode_scheme_code_idx" ON "IndustryExternalCode"("scheme", "code");

-- CreateIndex
CREATE UNIQUE INDEX "IndustryExternalCode_industryId_scheme_code_key" ON "IndustryExternalCode"("industryId", "scheme", "code");

-- CreateIndex
CREATE INDEX "IndustryAlias_normalized_idx" ON "IndustryAlias"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "IndustryAlias_industryId_normalized_key" ON "IndustryAlias"("industryId", "normalized");

-- CreateIndex
CREATE INDEX "CompanyIndustry_industryId_idx" ON "CompanyIndustry"("industryId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyIndustry_companyId_industryId_key" ON "CompanyIndustry"("companyId", "industryId");

-- CreateIndex
CREATE INDEX "DiscoveryLocation_projectId_idx" ON "DiscoveryLocation"("projectId");

-- CreateIndex
CREATE INDEX "DiscoveryLocation_geog_idx" ON "DiscoveryLocation" USING GIST ("geog");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryIndustryFilter_projectId_industryId_key" ON "DiscoveryIndustryFilter"("projectId", "industryId");

-- CreateIndex
CREATE INDEX "DiscoveryKeyword_projectId_idx" ON "DiscoveryKeyword"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySourceSelection_projectId_sourceId_key" ON "DiscoverySourceSelection"("projectId", "sourceId");

-- CreateIndex
CREATE INDEX "DiscoveryRun_status_scheduledFor_idx" ON "DiscoveryRun"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryRun_projectId_sourceId_key" ON "DiscoveryRun"("projectId", "sourceId");

-- CreateIndex
CREATE INDEX "ProjectCompany_companyId_idx" ON "ProjectCompany"("companyId");

-- CreateIndex
CREATE INDEX "SourceObservation_companyId_fieldName_idx" ON "SourceObservation"("companyId", "fieldName");

-- CreateIndex
CREATE INDEX "SourceObservation_sourceId_sourceRecordId_idx" ON "SourceObservation"("sourceId", "sourceRecordId");

-- CreateIndex
CREATE INDEX "CompanyDuplicateCandidate_organizationId_status_idx" ON "CompanyDuplicateCandidate"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyDuplicateCandidate_companyAId_companyBId_key" ON "CompanyDuplicateCandidate"("companyAId", "companyBId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSegment_organizationId_name_key" ON "SavedSegment"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_createdAt_idx" ON "Campaign"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignSend_campaignId_sentAt_idx" ON "CampaignSend"("campaignId", "sentAt");

-- CreateIndex
CREATE INDEX "Company_organizationId_normalizedName_idx" ON "Company"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "Company_organizationId_registrationNumber_idx" ON "Company"("organizationId", "registrationNumber");

-- CreateIndex
CREATE INDEX "Company_organizationId_updatedAt_id_idx" ON "Company"("organizationId", "updatedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "Company_organizationId_status_idx" ON "Company"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Company_organizationId_countryCode_idx" ON "Company"("organizationId", "countryCode");

-- CreateIndex
CREATE INDEX "Company_organizationId_createdAt_idx" ON "Company"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CompanyDomain_companyId_idx" ON "CompanyDomain"("companyId");

-- CreateIndex
CREATE INDEX "ConsentRecord_emailId_purpose_idx" ON "ConsentRecord"("emailId", "purpose");

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");

-- CreateIndex
CREATE INDEX "Contact_organizationId_updatedAt_idx" ON "Contact"("organizationId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Contact_organizationId_lastName_firstName_idx" ON "Contact"("organizationId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Contact_organizationId_category_idx" ON "Contact"("organizationId", "category");

-- CreateIndex
CREATE INDEX "Contact_phoneE164_idx" ON "Contact"("phoneE164");

-- CreateIndex
CREATE INDEX "ContactEmail_emailId_idx" ON "ContactEmail"("emailId");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_organizationId_status_dueAt_idx" ON "DataSubjectRequest"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "DiscoveryProject_organizationId_createdAt_idx" ON "DiscoveryProject"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DiscoveryProject_organizationId_status_idx" ON "DiscoveryProject"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Domain_nextCrawlAt_idx" ON "Domain"("nextCrawlAt");

-- CreateIndex
CREATE INDEX "Domain_cooldownUntil_idx" ON "Domain"("cooldownUntil");

-- CreateIndex
CREATE INDEX "DomainEvent_aggregateType_aggregateId_idx" ON "DomainEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "DomainEvent_occurredAt_idx" ON "DomainEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "EligibilityDecision_emailId_campaignId_decidedAt_idx" ON "EligibilityDecision"("emailId", "campaignId", "decidedAt" DESC);

-- CreateIndex
CREATE INDEX "EligibilityDecision_organizationId_outcome_idx" ON "EligibilityDecision"("organizationId", "outcome");

-- CreateIndex
CREATE INDEX "EmailAddress_domain_idx" ON "EmailAddress"("domain");

-- CreateIndex
CREATE INDEX "EmailAddress_status_idx" ON "EmailAddress"("status");

-- CreateIndex
CREATE INDEX "EmailAddress_domain_status_idx" ON "EmailAddress"("domain", "status");

-- CreateIndex
CREATE INDEX "EmailEvent_campaignId_occurredAt_idx" ON "EmailEvent"("campaignId", "occurredAt");

-- CreateIndex
CREATE INDEX "EmailEvent_emailId_occurredAt_idx" ON "EmailEvent"("emailId", "occurredAt");

-- CreateIndex
CREATE INDEX "EmailEvent_organizationId_type_occurredAt_idx" ON "EmailEvent"("organizationId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "EmailVerification_emailId_checkedAt_idx" ON "EmailVerification"("emailId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "ExtractionCandidate_organizationId_status_createdAt_idx" ON "ExtractionCandidate"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExtractionCandidate_normalizedValue_idx" ON "ExtractionCandidate"("normalizedValue");

-- CreateIndex
CREATE INDEX "ExtractionCandidate_companyId_idx" ON "ExtractionCandidate"("companyId");

-- CreateIndex
CREATE INDEX "ExtractionRun_startedAt_idx" ON "ExtractionRun"("startedAt");

-- CreateIndex
CREATE INDEX "FetchArtifact_bodySha256_idx" ON "FetchArtifact"("bodySha256");

-- CreateIndex
CREATE INDEX "FetchArtifact_fetchedAt_idx" ON "FetchArtifact"("fetchedAt");

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_createdAt_idx" ON "ImportJob"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "JurisdictionProfile_code_status_idx" ON "JurisdictionProfile"("code", "status");

-- CreateIndex
CREATE INDEX "LawfulBasisRecord_emailId_jurisdictionCode_idx" ON "LawfulBasisRecord"("emailId", "jurisdictionCode");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Source_organizationId_permitted_idx" ON "Source"("organizationId", "permitted");

-- CreateIndex
CREATE INDEX "Source_organizationId_policyStatus_enabled_idx" ON "Source"("organizationId", "policyStatus", "enabled");

-- CreateIndex
CREATE INDEX "SourceEvidence_companyId_fieldName_idx" ON "SourceEvidence"("companyId", "fieldName");

-- CreateIndex
CREATE INDEX "SourceEvidence_emailId_observedAt_idx" ON "SourceEvidence"("emailId", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "SourceEvidence_organizationId_observedAt_idx" ON "SourceEvidence"("organizationId", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "SuppressionEntry_emailNormalized_idx" ON "SuppressionEntry"("emailNormalized");

-- CreateIndex
CREATE INDEX "SuppressionEntry_domain_idx" ON "SuppressionEntry"("domain");

-- CreateIndex
CREATE INDEX "UnsubscribeToken_emailNormalized_idx" ON "UnsubscribeToken"("emailNormalized");

-- Reference data: continents and ISO 3166-1 countries (required by Company_countryCode_fkey).
INSERT INTO "GeoImportBatch" ("id", "source", "version", "licence", "attribution", "rowCount", "notes") VALUES ('iso3166-seed', 'ISO 3166-1 (bundled)', '2026-11', 'Public reference codes', 'ISO 3166 Maintenance Agency', 250, 'data/geography/seed/countries.tsv') ON CONFLICT DO NOTHING;
INSERT INTO "Continent" ("code", "name") VALUES ('AF', 'Africa'), ('AN', 'Antarctica'), ('AS', 'Asia'), ('EU', 'Europe'), ('NA', 'North America'), ('OC', 'Oceania'), ('SA', 'South America') ON CONFLICT DO NOTHING;
INSERT INTO "Country" ("iso2", "iso3", "isoNumeric", "name", "continentCode", "importBatchId", "updatedAt") VALUES
('AD', 'AND', 20, 'Andorra', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('AE', 'ARE', 784, 'United Arab Emirates', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('AF', 'AFG', 4, 'Afghanistan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('AG', 'ATG', 28, 'Antigua and Barbuda', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('AI', 'AIA', 660, 'Anguilla', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('AL', 'ALB', 8, 'Albania', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('AM', 'ARM', 51, 'Armenia', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('AO', 'AGO', 24, 'Angola', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('AQ', 'ATA', 10, 'Antarctica', 'AN', 'iso3166-seed', CURRENT_TIMESTAMP),
('AR', 'ARG', 32, 'Argentina', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('AS', 'ASM', 16, 'American Samoa', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('AT', 'AUT', 40, 'Austria', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('AU', 'AUS', 36, 'Australia', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('AW', 'ABW', 533, 'Aruba', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('AX', 'ALA', 248, 'Åland Islands', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('AZ', 'AZE', 31, 'Azerbaijan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('BA', 'BIH', 70, 'Bosnia and Herzegovina', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('BB', 'BRB', 52, 'Barbados', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('BD', 'BGD', 50, 'Bangladesh', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('BE', 'BEL', 56, 'Belgium', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('BF', 'BFA', 854, 'Burkina Faso', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('BG', 'BGR', 100, 'Bulgaria', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('BH', 'BHR', 48, 'Bahrain', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('BI', 'BDI', 108, 'Burundi', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('BJ', 'BEN', 204, 'Benin', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('BL', 'BLM', 652, 'Saint Barthélemy', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('BM', 'BMU', 60, 'Bermuda', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('BN', 'BRN', 96, 'Brunei Darussalam', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('BO', 'BOL', 68, 'Bolivia', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('BQ', 'BES', 535, 'Bonaire, Sint Eustatius and Saba', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('BR', 'BRA', 76, 'Brazil', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('BS', 'BHS', 44, 'Bahamas', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('BT', 'BTN', 64, 'Bhutan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('BV', 'BVT', 74, 'Bouvet Island', 'AN', 'iso3166-seed', CURRENT_TIMESTAMP),
('BW', 'BWA', 72, 'Botswana', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('BY', 'BLR', 112, 'Belarus', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('BZ', 'BLZ', 84, 'Belize', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('CA', 'CAN', 124, 'Canada', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('CC', 'CCK', 166, 'Cocos (Keeling) Islands', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('CD', 'COD', 180, 'Congo, Democratic Republic of the', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('CF', 'CAF', 140, 'Central African Republic', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('CG', 'COG', 178, 'Congo', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('CH', 'CHE', 756, 'Switzerland', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('CI', 'CIV', 384, 'Côte d''Ivoire', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('CK', 'COK', 184, 'Cook Islands', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('CL', 'CHL', 152, 'Chile', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('CM', 'CMR', 120, 'Cameroon', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('CN', 'CHN', 156, 'China', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('CO', 'COL', 170, 'Colombia', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('CR', 'CRI', 188, 'Costa Rica', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('CU', 'CUB', 192, 'Cuba', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('CV', 'CPV', 132, 'Cabo Verde', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('CW', 'CUW', 531, 'Curaçao', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('CX', 'CXR', 162, 'Christmas Island', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('CY', 'CYP', 196, 'Cyprus', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('CZ', 'CZE', 203, 'Czechia', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('DE', 'DEU', 276, 'Germany', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('DJ', 'DJI', 262, 'Djibouti', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('DK', 'DNK', 208, 'Denmark', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('DM', 'DMA', 212, 'Dominica', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('DO', 'DOM', 214, 'Dominican Republic', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('DZ', 'DZA', 12, 'Algeria', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('EC', 'ECU', 218, 'Ecuador', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('EE', 'EST', 233, 'Estonia', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('EG', 'EGY', 818, 'Egypt', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('EH', 'ESH', 732, 'Western Sahara', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('ER', 'ERI', 232, 'Eritrea', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('ES', 'ESP', 724, 'Spain', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('ET', 'ETH', 231, 'Ethiopia', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('FI', 'FIN', 246, 'Finland', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('FJ', 'FJI', 242, 'Fiji', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('FK', 'FLK', 238, 'Falkland Islands (Malvinas)', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('FM', 'FSM', 583, 'Micronesia', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('FO', 'FRO', 234, 'Faroe Islands', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('FR', 'FRA', 250, 'France', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('GA', 'GAB', 266, 'Gabon', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('GB', 'GBR', 826, 'United Kingdom', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('GD', 'GRD', 308, 'Grenada', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('GE', 'GEO', 268, 'Georgia', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('GF', 'GUF', 254, 'French Guiana', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('GG', 'GGY', 831, 'Guernsey', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('GH', 'GHA', 288, 'Ghana', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('GI', 'GIB', 292, 'Gibraltar', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('GL', 'GRL', 304, 'Greenland', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('GM', 'GMB', 270, 'Gambia', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('GN', 'GIN', 324, 'Guinea', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('GP', 'GLP', 312, 'Guadeloupe', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('GQ', 'GNQ', 226, 'Equatorial Guinea', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('GR', 'GRC', 300, 'Greece', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('GS', 'SGS', 239, 'South Georgia and the South Sandwich Islands', 'AN', 'iso3166-seed', CURRENT_TIMESTAMP),
('GT', 'GTM', 320, 'Guatemala', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('GU', 'GUM', 316, 'Guam', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('GW', 'GNB', 624, 'Guinea-Bissau', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('GY', 'GUY', 328, 'Guyana', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('HK', 'HKG', 344, 'Hong Kong', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('HM', 'HMD', 334, 'Heard Island and McDonald Islands', 'AN', 'iso3166-seed', CURRENT_TIMESTAMP),
('HN', 'HND', 340, 'Honduras', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('HR', 'HRV', 191, 'Croatia', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('HT', 'HTI', 332, 'Haiti', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('HU', 'HUN', 348, 'Hungary', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('ID', 'IDN', 360, 'Indonesia', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('IE', 'IRL', 372, 'Ireland', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('IL', 'ISR', 376, 'Israel', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('IM', 'IMN', 833, 'Isle of Man', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('IN', 'IND', 356, 'India', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('IO', 'IOT', 86, 'British Indian Ocean Territory', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('IQ', 'IRQ', 368, 'Iraq', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('IR', 'IRN', 364, 'Iran', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('IS', 'ISL', 352, 'Iceland', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('IT', 'ITA', 380, 'Italy', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('JE', 'JEY', 832, 'Jersey', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('JM', 'JAM', 388, 'Jamaica', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('JO', 'JOR', 400, 'Jordan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('JP', 'JPN', 392, 'Japan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('KE', 'KEN', 404, 'Kenya', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('KG', 'KGZ', 417, 'Kyrgyzstan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('KH', 'KHM', 116, 'Cambodia', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('KI', 'KIR', 296, 'Kiribati', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('KM', 'COM', 174, 'Comoros', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('KN', 'KNA', 659, 'Saint Kitts and Nevis', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('KP', 'PRK', 408, 'Korea, Democratic People''s Republic of', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('KR', 'KOR', 410, 'Korea, Republic of', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('KW', 'KWT', 414, 'Kuwait', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('KY', 'CYM', 136, 'Cayman Islands', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('KZ', 'KAZ', 398, 'Kazakhstan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('LA', 'LAO', 418, 'Lao People''s Democratic Republic', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('LB', 'LBN', 422, 'Lebanon', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('LC', 'LCA', 662, 'Saint Lucia', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('LI', 'LIE', 438, 'Liechtenstein', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('LK', 'LKA', 144, 'Sri Lanka', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('LR', 'LBR', 430, 'Liberia', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('LS', 'LSO', 426, 'Lesotho', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('LT', 'LTU', 440, 'Lithuania', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('LU', 'LUX', 442, 'Luxembourg', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('LV', 'LVA', 428, 'Latvia', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('LY', 'LBY', 434, 'Libya', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('MA', 'MAR', 504, 'Morocco', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('MC', 'MCO', 492, 'Monaco', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('MD', 'MDA', 498, 'Moldova', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('ME', 'MNE', 499, 'Montenegro', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('MF', 'MAF', 663, 'Saint Martin (French part)', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('MG', 'MDG', 450, 'Madagascar', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('MH', 'MHL', 584, 'Marshall Islands', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('MK', 'MKD', 807, 'North Macedonia', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('ML', 'MLI', 466, 'Mali', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('MM', 'MMR', 104, 'Myanmar', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('MN', 'MNG', 496, 'Mongolia', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('MO', 'MAC', 446, 'Macao', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('MP', 'MNP', 580, 'Northern Mariana Islands', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('MQ', 'MTQ', 474, 'Martinique', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('MR', 'MRT', 478, 'Mauritania', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('MS', 'MSR', 500, 'Montserrat', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('MT', 'MLT', 470, 'Malta', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('MU', 'MUS', 480, 'Mauritius', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('MV', 'MDV', 462, 'Maldives', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('MW', 'MWI', 454, 'Malawi', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('MX', 'MEX', 484, 'Mexico', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('MY', 'MYS', 458, 'Malaysia', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('MZ', 'MOZ', 508, 'Mozambique', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('NA', 'NAM', 516, 'Namibia', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('NC', 'NCL', 540, 'New Caledonia', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('NE', 'NER', 562, 'Niger', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('NF', 'NFK', 574, 'Norfolk Island', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('NG', 'NGA', 566, 'Nigeria', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('NI', 'NIC', 558, 'Nicaragua', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('NL', 'NLD', 528, 'Netherlands', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('NO', 'NOR', 578, 'Norway', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('NP', 'NPL', 524, 'Nepal', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('NR', 'NRU', 520, 'Nauru', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('NU', 'NIU', 570, 'Niue', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('NZ', 'NZL', 554, 'New Zealand', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('OM', 'OMN', 512, 'Oman', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('PA', 'PAN', 591, 'Panama', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('PE', 'PER', 604, 'Peru', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('PF', 'PYF', 258, 'French Polynesia', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('PG', 'PNG', 598, 'Papua New Guinea', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('PH', 'PHL', 608, 'Philippines', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('PK', 'PAK', 586, 'Pakistan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('PL', 'POL', 616, 'Poland', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('PM', 'SPM', 666, 'Saint Pierre and Miquelon', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('PN', 'PCN', 612, 'Pitcairn', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('PR', 'PRI', 630, 'Puerto Rico', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('PS', 'PSE', 275, 'Palestine, State of', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('PT', 'PRT', 620, 'Portugal', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('PW', 'PLW', 585, 'Palau', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('PY', 'PRY', 600, 'Paraguay', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('QA', 'QAT', 634, 'Qatar', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('RE', 'REU', 638, 'Réunion', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('RO', 'ROU', 642, 'Romania', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('RS', 'SRB', 688, 'Serbia', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('RU', 'RUS', 643, 'Russian Federation', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('RW', 'RWA', 646, 'Rwanda', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('SA', 'SAU', 682, 'Saudi Arabia', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('SB', 'SLB', 90, 'Solomon Islands', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('SC', 'SYC', 690, 'Seychelles', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('SD', 'SDN', 729, 'Sudan', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('SE', 'SWE', 752, 'Sweden', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('SG', 'SGP', 702, 'Singapore', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('SH', 'SHN', 654, 'Saint Helena, Ascension and Tristan da Cunha', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('SI', 'SVN', 705, 'Slovenia', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('SJ', 'SJM', 744, 'Svalbard and Jan Mayen', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('SK', 'SVK', 703, 'Slovakia', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('SL', 'SLE', 694, 'Sierra Leone', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('SM', 'SMR', 674, 'San Marino', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('SN', 'SEN', 686, 'Senegal', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('SO', 'SOM', 706, 'Somalia', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('SR', 'SUR', 740, 'Suriname', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('SS', 'SSD', 728, 'South Sudan', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('ST', 'STP', 678, 'Sao Tome and Principe', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('SV', 'SLV', 222, 'El Salvador', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('SX', 'SXM', 534, 'Sint Maarten (Dutch part)', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('SY', 'SYR', 760, 'Syrian Arab Republic', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('SZ', 'SWZ', 748, 'Eswatini', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('TC', 'TCA', 796, 'Turks and Caicos Islands', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('TD', 'TCD', 148, 'Chad', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('TF', 'ATF', 260, 'French Southern Territories', 'AN', 'iso3166-seed', CURRENT_TIMESTAMP),
('TG', 'TGO', 768, 'Togo', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('TH', 'THA', 764, 'Thailand', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('TJ', 'TJK', 762, 'Tajikistan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('TK', 'TKL', 772, 'Tokelau', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('TL', 'TLS', 626, 'Timor-Leste', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('TM', 'TKM', 795, 'Turkmenistan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('TN', 'TUN', 788, 'Tunisia', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('TO', 'TON', 776, 'Tonga', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('TR', 'TUR', 792, 'Türkiye', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('TT', 'TTO', 780, 'Trinidad and Tobago', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('TV', 'TUV', 798, 'Tuvalu', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('TW', 'TWN', 158, 'Taiwan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('TZ', 'TZA', 834, 'Tanzania', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('UA', 'UKR', 804, 'Ukraine', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('UG', 'UGA', 800, 'Uganda', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('UM', 'UMI', 581, 'United States Minor Outlying Islands', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('US', 'USA', 840, 'United States', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('UY', 'URY', 858, 'Uruguay', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('UZ', 'UZB', 860, 'Uzbekistan', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('VA', 'VAT', 336, 'Holy See', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('VC', 'VCT', 670, 'Saint Vincent and the Grenadines', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('VE', 'VEN', 862, 'Venezuela', 'SA', 'iso3166-seed', CURRENT_TIMESTAMP),
('VG', 'VGB', 92, 'Virgin Islands (British)', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('VI', 'VIR', 850, 'Virgin Islands (U.S.)', 'NA', 'iso3166-seed', CURRENT_TIMESTAMP),
('VN', 'VNM', 704, 'Viet Nam', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('VU', 'VUT', 548, 'Vanuatu', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('WF', 'WLF', 876, 'Wallis and Futuna', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('WS', 'WSM', 882, 'Samoa', 'OC', 'iso3166-seed', CURRENT_TIMESTAMP),
('XK', 'XKX', NULL, 'Kosovo', 'EU', 'iso3166-seed', CURRENT_TIMESTAMP),
('YE', 'YEM', 887, 'Yemen', 'AS', 'iso3166-seed', CURRENT_TIMESTAMP),
('YT', 'MYT', 175, 'Mayotte', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('ZA', 'ZAF', 710, 'South Africa', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('ZM', 'ZMB', 894, 'Zambia', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP),
('ZW', 'ZWE', 716, 'Zimbabwe', 'AF', 'iso3166-seed', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Company.countryCode must reference a known ISO code before the FK is added.
UPDATE "Company" SET "countryCode" = 'GB' WHERE "countryCode" = 'UK';
UPDATE "Company" SET "countryCode" = NULL WHERE "countryCode" IS NOT NULL AND "countryCode" NOT IN (SELECT "iso2" FROM "Country");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("iso2") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryProject" ADD CONSTRAINT "DiscoveryProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJob" ADD CONSTRAINT "CrawlJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJob" ADD CONSTRAINT "CrawlJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DiscoveryProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJob" ADD CONSTRAINT "CrawlJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJob" ADD CONSTRAINT "CrawlJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJob" ADD CONSTRAINT "CrawlJob_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlPage" ADD CONSTRAINT "CrawlPage_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlPage" ADD CONSTRAINT "CrawlPage_fetchArtifactId_fkey" FOREIGN KEY ("fetchArtifactId") REFERENCES "FetchArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Country" ADD CONSTRAINT "Country_continentCode_fkey" FOREIGN KEY ("continentCode") REFERENCES "Continent"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Country" ADD CONSTRAINT "Country_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "GeoImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRegion" ADD CONSTRAINT "AdminRegion_countryIso2_fkey" FOREIGN KEY ("countryIso2") REFERENCES "Country"("iso2") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRegion" ADD CONSTRAINT "AdminRegion_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "GeoImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_countryIso2_fkey" FOREIGN KEY ("countryIso2") REFERENCES "Country"("iso2") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "AdminRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "GeoImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostalArea" ADD CONSTRAINT "PostalArea_countryIso2_fkey" FOREIGN KEY ("countryIso2") REFERENCES "Country"("iso2") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostalArea" ADD CONSTRAINT "PostalArea_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "AdminRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostalArea" ADD CONSTRAINT "PostalArea_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostalArea" ADD CONSTRAINT "PostalArea_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "GeoImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "CompanyLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "CompanyLocation_countryIso2_fkey" FOREIGN KEY ("countryIso2") REFERENCES "Country"("iso2") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "CompanyLocation_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "AdminRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "CompanyLocation_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "CompanyLocation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Industry" ADD CONSTRAINT "Industry_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "IndustryTaxonomyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Industry" ADD CONSTRAINT "Industry_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Industry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndustryExternalCode" ADD CONSTRAINT "IndustryExternalCode_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndustryAlias" ADD CONSTRAINT "IndustryAlias_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIndustry" ADD CONSTRAINT "CompanyIndustry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIndustry" ADD CONSTRAINT "CompanyIndustry_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIndustry" ADD CONSTRAINT "CompanyIndustry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryLocation" ADD CONSTRAINT "DiscoveryLocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DiscoveryProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryLocation" ADD CONSTRAINT "DiscoveryLocation_countryIso2_fkey" FOREIGN KEY ("countryIso2") REFERENCES "Country"("iso2") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryLocation" ADD CONSTRAINT "DiscoveryLocation_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "AdminRegion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryLocation" ADD CONSTRAINT "DiscoveryLocation_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryLocation" ADD CONSTRAINT "DiscoveryLocation_postalAreaId_fkey" FOREIGN KEY ("postalAreaId") REFERENCES "PostalArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryIndustryFilter" ADD CONSTRAINT "DiscoveryIndustryFilter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DiscoveryProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryIndustryFilter" ADD CONSTRAINT "DiscoveryIndustryFilter_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryKeyword" ADD CONSTRAINT "DiscoveryKeyword_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DiscoveryProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverySourceSelection" ADD CONSTRAINT "DiscoverySourceSelection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DiscoveryProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverySourceSelection" ADD CONSTRAINT "DiscoverySourceSelection_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DiscoveryProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCompany" ADD CONSTRAINT "ProjectCompany_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DiscoveryProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCompany" ADD CONSTRAINT "ProjectCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "DiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceObservation" ADD CONSTRAINT "SourceObservation_rawArtifactId_fkey" FOREIGN KEY ("rawArtifactId") REFERENCES "FetchArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDuplicateCandidate" ADD CONSTRAINT "CompanyDuplicateCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDuplicateCandidate" ADD CONSTRAINT "CompanyDuplicateCandidate_companyAId_fkey" FOREIGN KEY ("companyAId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDuplicateCandidate" ADD CONSTRAINT "CompanyDuplicateCandidate_companyBId_fkey" FOREIGN KEY ("companyBId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSegment" ADD CONSTRAINT "SavedSegment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data moves
-- ---------------------------------------------------------------------------

UPDATE "Company" SET "normalizedName" = lower(regexp_replace(trim("name"), '\s+', ' ', 'g'));

INSERT INTO "CompanyLocation" ("id", "companyId", "rawText", "countryIso2", "resolution", "confidence")
SELECT 'loc_' || b."id", b."id",
       NULLIF(concat_ws(', ', NULLIF(b."city", ''), NULLIF(b."region", '')), ''),
       CASE WHEN c."iso2" IS NOT NULL THEN b."countryCode" ELSE NULL END,
       'UNRESOLVED', 0.3
FROM "_realign_company_loc" b
LEFT JOIN "Country" c ON c."iso2" = CASE WHEN b."countryCode" = 'UK' THEN 'GB' ELSE b."countryCode" END;

UPDATE "DiscoveryProject" p SET
  "status" = CASE WHEN b."status" IN ('DRAFT','READY','QUEUED','RUNNING','PAUSED','COMPLETED','CANCELLED','FAILED')
                  THEN b."status"::"ProjectStatus" ELSE 'READY'::"ProjectStatus" END,
  "maxCompanies" = COALESCE((b."budget"->>'maxTargets')::int, (b."criteria"->>'maxTargets')::int, 500),
  "maxPagesPerCompany" = COALESCE((b."budget"->>'maxPagesPerDomain')::int, 12),
  "maxCrawlDepth" = COALESCE((b."budget"->>'maxDepth')::int, 2),
  "settings" = jsonb_build_object('legacyCriteria', b."criteria", 'legacyBudget', b."budget")
FROM "_realign_project" b WHERE b."id" = p."id";

INSERT INTO "DiscoveryLocation" ("id", "projectId", "mode", "level", "countryIso2")
SELECT 'dl_' || b."id" || '_' || cc.code, b."id", 'INCLUDE', 'COUNTRY', cc.code
FROM "_realign_project" b
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b."criteria"->'countries', '[]'::jsonb)) AS cc(code)
WHERE cc.code IN (SELECT "iso2" FROM "Country");

INSERT INTO "DiscoveryKeyword" ("id", "projectId", "keyword")
SELECT 'dk_' || b."id" || '_' || md5(kw.value), b."id", kw.value
FROM "_realign_project" b
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b."criteria"->'keywords', '[]'::jsonb)) AS kw(value);

INSERT INTO "CrawlJob" ("id", "organizationId", "projectId", "sourceId", "domainId", "rootUrl", "urlHash",
  "status", "priority", "attemptCount", "errorMessage", "scheduledFor", "createdAt", "updatedAt", "maxDepth")
SELECT t."id", t."organizationId", t."projectId", t."sourceId", t."domainId", t."url", t."urlHash",
  (CASE t."status" WHEN 'DONE' THEN 'SUCCEEDED' WHEN 'RUNNING' THEN 'QUEUED' ELSE t."status" END)::"CrawlJobStatus",
  t."priority", t."attempts", t."lastError", t."scheduledFor", t."createdAt", t."updatedAt", GREATEST(t."depth", 1)
FROM "_realign_crawl" t;

UPDATE "CrawlJob" j SET "companyId" = cd."companyId"
FROM "CompanyDomain" cd WHERE cd."domainId" = j."domainId" AND j."companyId" IS NULL;

DROP TABLE "_realign_company_loc";
DROP TABLE "_realign_project";
DROP TABLE "_realign_crawl";
