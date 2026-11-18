-- LeadForge initial schema
-- Generated from packages/database/prisma/schema.prisma.
-- Apply with `prisma migrate deploy` (production) or `pnpm db:deploy`.

CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'VIEWER');
CREATE TYPE "CompanyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'STALE', 'ARCHIVED');
CREATE TYPE "ContactType" AS ENUM ('PERSON', 'GENERIC_BUSINESS');
CREATE TYPE "ContactStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "EmailStatus" AS ENUM ('DISCOVERED', 'SYNTAX_VALID', 'DNS_VALID', 'MX_VALID', 'DELIVERABILITY_UNKNOWN', 'RISKY', 'UNDELIVERABLE', 'SUPPRESSED');
CREATE TYPE "CandidateKind" AS ENUM ('EMAIL', 'COMPANY', 'PERSON');
CREATE TYPE "CandidateStatus" AS ENUM ('PENDING', 'PROMOTED', 'REJECTED');
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "CrawlTargetStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'BLOCKED');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'REVIEW', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'EXCLUDED', 'SUPPRESSED');
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'COMPLAINT', 'HARD_BOUNCE', 'MANUAL', 'LEGAL_OBJECTION');
CREATE TYPE "EligibilityOutcome" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'NEEDS_REVIEW', 'SUPPRESSED', 'UNKNOWN_JURISDICTION');
CREATE TYPE "BasisType" AS ENUM ('CONSENT', 'LEGITIMATE_INTEREST', 'CONTRACT', 'LEGAL_OBLIGATION');
CREATE TYPE "ProfileStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "countryCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    PRIMARY KEY ("id")
);

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "totpSecret" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("userId", "organizationId")
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    PRIMARY KEY ("id")
);

CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    PRIMARY KEY ("id")
);

CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "description" TEXT,
    "countryCode" TEXT,
    "region" TEXT,
    "city" TEXT,
    "industry" TEXT,
    "employeeRange" TEXT,
    "revenueRange" TEXT,
    "foundedYear" INTEGER,
    "website" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    PRIMARY KEY ("id")
);

CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "registrableDomain" TEXT NOT NULL,
    "tld" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastCrawledAt" TIMESTAMP(3),
    "nextCrawlAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "robotsHash" TEXT,
    "crawlBudgetUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "CompanyDomain" (
    "companyId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("companyId", "domainId")
);

CREATE TABLE "DomainHealth" (
    "domainId" TEXT NOT NULL,
    "mxPresent" BOOLEAN NOT NULL DEFAULT false,
    "spfPresent" BOOLEAN NOT NULL DEFAULT false,
    "dmarcPresent" BOOLEAN NOT NULL DEFAULT false,
    "catchAllSuspected" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("domainId")
);

CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ContactType" NOT NULL DEFAULT 'PERSON',
    "firstName" TEXT,
    "lastName" TEXT,
    "jobTitle" TEXT,
    "jobFunction" TEXT,
    "seniority" TEXT,
    "department" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    PRIMARY KEY ("id")
);

CREATE TABLE "EmailAddress" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "localPart" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'DISCOVERED',
    "isRoleAccount" BOOLEAN NOT NULL DEFAULT false,
    "isDisposable" BOOLEAN NOT NULL DEFAULT false,
    "isFreeProvider" BOOLEAN NOT NULL DEFAULT false,
    "patternInferred" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "verificationExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "ContactEmail" (
    "contactId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL DEFAULT 'WORK',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("contactId", "emailId")
);

CREATE TABLE "EmailPattern" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'OBSERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "baseUrl" TEXT,
    "permitted" BOOLEAN NOT NULL DEFAULT false,
    "policyNotes" TEXT,
    "tosUrl" TEXT,
    "tosReviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "rateLimit" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "DiscoveryProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "criteria" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "budget" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "CrawlTarget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceId" TEXT,
    "domainId" TEXT,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "status" "CrawlTargetStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "FetchArtifact" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "contentType" TEXT,
    "bodySha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "robotsAllowed" BOOLEAN NOT NULL DEFAULT true,
    "renderMode" TEXT NOT NULL DEFAULT 'HTTP',
    PRIMARY KEY ("id")
);

CREATE TABLE "ExtractionRun" (
    "id" TEXT NOT NULL,
    "fetchArtifactId" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "modelVersion" TEXT,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    PRIMARY KEY ("id")
);

CREATE TABLE "ExtractionCandidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "runId" TEXT,
    "fetchArtifactId" TEXT NOT NULL,
    "kind" "CandidateKind" NOT NULL,
    "rawValue" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "selector" TEXT,
    "snippet" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "promotedEmailId" TEXT,
    "promotedContactId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE TABLE "SourceEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "emailId" TEXT,
    "domainId" TEXT,
    "sourceId" TEXT,
    "fetchArtifactId" TEXT,
    "pageUrl" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "extractedValue" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL DEFAULT 'manual',
    "method" TEXT NOT NULL DEFAULT 'manual',
    "snippet" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT,
    PRIMARY KEY ("id")
);

CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "details" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "resolver" TEXT,
    PRIMARY KEY ("id")
);

CREATE TABLE "JurisdictionProfile" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "ProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "rules" JSONB NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "obtainedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE TABLE "LawfulBasisRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "basis" "BasisType" NOT NULL,
    "assessment" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "jurisdictionCode" TEXT NOT NULL,
    "campaignId" TEXT,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "emailNormalized" TEXT NOT NULL,
    "domain" TEXT,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedBy" TEXT,
    PRIMARY KEY ("id")
);

CREATE TABLE "EligibilityDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "campaignId" TEXT,
    "contextHash" TEXT NOT NULL,
    "ruleSetVersion" TEXT NOT NULL,
    "outcome" "EligibilityOutcome" NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "requiredActions" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "supersededBy" TEXT,
    PRIMARY KEY ("id")
);

CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subjectEmail" TEXT NOT NULL,
    "emailId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY ("id")
);

CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "segmentDefinition" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "jurisdictionScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lawfulBasis" "BasisType",
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "emailSnapshot" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "eligibilityDecisionId" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    PRIMARY KEY ("id")
);

CREATE TABLE "CampaignSend" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL DEFAULT 'smtp',
    "providerMessageId" TEXT,
    "smtpResponse" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "emailId" TEXT,
    "campaignId" TEXT,
    "type" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY ("id")
);

CREATE TABLE "UnsubscribeToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "ip" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
);

CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization" ("slug");
CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session" ("tokenHash");
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey" ("prefix");
CREATE UNIQUE INDEX "Company_organizationId_name_countryCode_key" ON "Company" ("organizationId", "name", "countryCode");
CREATE UNIQUE INDEX "Domain_domain_key" ON "Domain" ("domain");
CREATE UNIQUE INDEX "CompanyDomain_domainId_key" ON "CompanyDomain" ("domainId");
CREATE UNIQUE INDEX "EmailAddress_normalized_key" ON "EmailAddress" ("normalized");
CREATE UNIQUE INDEX "EmailPattern_domain_pattern_key" ON "EmailPattern" ("domain", "pattern");
CREATE UNIQUE INDEX "Source_organizationId_name_key" ON "Source" ("organizationId", "name");
CREATE UNIQUE INDEX "CrawlTarget_projectId_urlHash_key" ON "CrawlTarget" ("projectId", "urlHash");
CREATE UNIQUE INDEX "ExtractionRun_fetchArtifactId_extractorVersion_key" ON "ExtractionRun" ("fetchArtifactId", "extractorVersion");
CREATE UNIQUE INDEX "JurisdictionProfile_code_version_key" ON "JurisdictionProfile" ("code", "version");
CREATE UNIQUE INDEX "SuppressionEntry_organizationId_emailNormalized_reason_key" ON "SuppressionEntry" ("organizationId", "emailNormalized", "reason");
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_emailId_key" ON "CampaignRecipient" ("campaignId", "emailId");
CREATE UNIQUE INDEX "EmailTemplate_organizationId_name_version_key" ON "EmailTemplate" ("organizationId", "name", "version");
CREATE UNIQUE INDEX "UnsubscribeToken_token_key" ON "UnsubscribeToken" ("token");
CREATE UNIQUE INDEX "ImportJob_idempotencyKey_key" ON "ImportJob" ("idempotencyKey");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Company" ADD CONSTRAINT "Company_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyDomain" ADD CONSTRAINT "CompanyDomain_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyDomain" ADD CONSTRAINT "CompanyDomain_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DomainHealth" ADD CONSTRAINT "DomainHealth_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactEmail" ADD CONSTRAINT "ContactEmail_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactEmail" ADD CONSTRAINT "ContactEmail_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Source" ADD CONSTRAINT "Source_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryProject" ADD CONSTRAINT "DiscoveryProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrawlTarget" ADD CONSTRAINT "CrawlTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrawlTarget" ADD CONSTRAINT "CrawlTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DiscoveryProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrawlTarget" ADD CONSTRAINT "CrawlTarget_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrawlTarget" ADD CONSTRAINT "CrawlTarget_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_fetchArtifactId_fkey" FOREIGN KEY ("fetchArtifactId") REFERENCES "FetchArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_fetchArtifactId_fkey" FOREIGN KEY ("fetchArtifactId") REFERENCES "FetchArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_fetchArtifactId_fkey" FOREIGN KEY ("fetchArtifactId") REFERENCES "FetchArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LawfulBasisRecord" ADD CONSTRAINT "LawfulBasisRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LawfulBasisRecord" ADD CONSTRAINT "LawfulBasisRecord_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EligibilityDecision" ADD CONSTRAINT "EligibilityDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EligibilityDecision" ADD CONSTRAINT "EligibilityDecision_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "CampaignRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "EmailAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

