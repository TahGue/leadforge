"""Postgres persistence for the Python workers (async, psycopg 3).

Postgres is the system of record (ADR-0002/0021): work is claimed with
``FOR UPDATE SKIP LOCKED`` and every state change is a row update, so any
number of worker processes can run safely.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import settings
from .extract import Candidate

AsyncConn = psycopg.AsyncConnection[dict[str, Any]]


def new_id() -> str:
    return uuid.uuid4().hex


def dsn() -> str:
    # Prisma-style URLs carry ?schema=public, which libpq does not understand.
    return settings.database_url.split("?")[0]


async def connect() -> AsyncConn:
    return await psycopg.AsyncConnection.connect(dsn(), row_factory=dict_row, autocommit=False)


# ---------------------------------------------------------------------------
# Crawl jobs
# ---------------------------------------------------------------------------


@dataclass
class CrawlJob:
    id: str
    organization_id: str
    project_id: str | None
    company_id: str | None
    domain_id: str | None
    domain: str | None
    root_url: str
    attempt_count: int
    max_attempts: int
    max_pages: int
    max_depth: int
    country: str | None
    settings: dict[str, Any] = field(default_factory=dict)
    min_confidence: float = 0.5


async def claim_crawl_job(conn: AsyncConn) -> CrawlJob | None:
    """Claim the next due job whose project is running, one job per domain at a time."""
    row = await (
        await conn.execute(
            """
            UPDATE "CrawlJob" AS j
            SET status = 'RUNNING', "attemptCount" = j."attemptCount" + 1,
                "startedAt" = now(), "updatedAt" = now()
            WHERE j.id = (
                SELECT c.id FROM "CrawlJob" c
                LEFT JOIN "DiscoveryProject" p ON p.id = c."projectId"
                LEFT JOIN "Domain" d ON d.id = c."domainId"
                WHERE c.status = 'QUEUED' AND c."scheduledFor" <= now()
                  AND (p.id IS NULL OR p.status = 'RUNNING')
                  AND (d."cooldownUntil" IS NULL OR d."cooldownUntil" <= now())
                  AND NOT EXISTS (
                      SELECT 1 FROM "CrawlJob" r
                      WHERE r."domainId" = c."domainId" AND r.status = 'RUNNING'
                  )
                ORDER BY c.priority ASC, c."scheduledFor" ASC
                LIMIT 1
                FOR UPDATE OF c SKIP LOCKED
            )
            RETURNING j.id, j."organizationId", j."projectId", j."companyId", j."domainId",
                      j."rootUrl", j."attemptCount", j."maxAttempts", j."maxPages", j."maxDepth"
            """
        )
    ).fetchone()
    if row is None:
        await conn.commit()
        return None
    extra = await (
        await conn.execute(
            """
            SELECT d.domain, c."countryCode" AS country, p.settings, p."minConfidence"
            FROM "CrawlJob" j
            LEFT JOIN "Domain" d ON d.id = j."domainId"
            LEFT JOIN "Company" c ON c.id = j."companyId"
            LEFT JOIN "DiscoveryProject" p ON p.id = j."projectId"
            WHERE j.id = %s
            """,
            (row["id"],),
        )
    ).fetchone()
    await conn.commit()
    return CrawlJob(
        id=row["id"],
        organization_id=row["organizationId"],
        project_id=row["projectId"],
        company_id=row["companyId"],
        domain_id=row["domainId"],
        domain=(extra or {}).get("domain"),
        root_url=row["rootUrl"],
        attempt_count=row["attemptCount"],
        max_attempts=row["maxAttempts"],
        max_pages=row["maxPages"],
        max_depth=row["maxDepth"],
        country=(extra or {}).get("country"),
        settings=((extra or {}).get("settings") or {}),
        min_confidence=float((extra or {}).get("minConfidence") or 0.5),
    )


async def project_status(conn: AsyncConn, project_id: str | None) -> str | None:
    if not project_id:
        return None
    row = await (await conn.execute('SELECT status FROM "DiscoveryProject" WHERE id = %s', (project_id,))).fetchone()
    return row["status"] if row else None


async def finish_crawl_job(
    conn: AsyncConn,
    job_id: str,
    status: str,
    *,
    pages_fetched: int,
    pages_skipped: int,
    bytes_downloaded: int,
    duration_ms: int,
    metrics: dict[str, Any],
    error_code: str | None = None,
    error_message: str | None = None,
    policy_stop_reason: str | None = None,
    retry_at: datetime | None = None,
) -> None:
    await conn.execute(
        """
        UPDATE "CrawlJob" SET
            status = %s::"CrawlJobStatus",
            "pagesFetched" = %s, "pagesSkipped" = %s, "bytesDownloaded" = %s, "durationMs" = %s,
            metrics = %s, "errorCode" = %s, "errorMessage" = %s, "policyStopReason" = %s,
            "nextRetryAt" = %s, "scheduledFor" = COALESCE(%s, "scheduledFor"),
            "finishedAt" = CASE WHEN %s = 'QUEUED' THEN NULL ELSE now() END,
            "updatedAt" = now()
        WHERE id = %s
        """,
        (
            status,
            pages_fetched,
            pages_skipped,
            bytes_downloaded,
            duration_ms,
            Jsonb(metrics),
            error_code,
            (error_message or "")[:1000] or None,
            policy_stop_reason,
            retry_at,
            retry_at,
            status,
            job_id,
        ),
    )


async def heartbeat(conn: AsyncConn, job_id: str, pages: int) -> None:
    await conn.execute('UPDATE "CrawlJob" SET "pagesFetched" = %s, "updatedAt" = now() WHERE id = %s', (pages, job_id))


async def record_page(
    conn: AsyncConn,
    *,
    job_id: str,
    url: str,
    final_url: str | None,
    depth: int,
    kind: str,
    http_status: int | None,
    content_type: str | None,
    content_hash: str | None,
    duration_ms: int,
    bytes_received: int,
    render_mode: str,
    parse_status: str,
    skip_reason: str | None,
    artifact_id: str | None,
) -> None:
    await conn.execute(
        """
        INSERT INTO "CrawlPage" (id, "crawlJobId", url, "finalUrl", depth, "pageKind", "httpStatus",
            "contentType", "contentHash", "fetchedAt", "durationMs", "bytesReceived", "renderMode",
            "parseStatus", "skipReason", "fetchArtifactId")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now(), %s, %s, %s, %s, %s, %s)
        """,
        (
            new_id(), job_id, url, final_url, depth, kind, http_status, (content_type or "")[:200] or None,
            content_hash, duration_ms, bytes_received, render_mode, parse_status, skip_reason, artifact_id,
        ),
    )


async def save_artifact(
    conn: AsyncConn,
    *,
    url: str,
    final_url: str,
    status_code: int,
    content_type: str | None,
    body: bytes,
    render_mode: str = "HTTP",
    robots_allowed: bool = True,
) -> tuple[str, str]:
    """Content-addressed, gzip-compressed artifact on disk; metadata row in Postgres (ADR-0006)."""
    digest = hashlib.sha256(body).hexdigest()
    directory = Path(settings.artifact_dir) / digest[:2]
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{digest}.html.gz"
    if not path.exists():
        with gzip.open(path, "wb") as handle:
            handle.write(body)
    artifact_id = new_id()
    await conn.execute(
        """
        INSERT INTO "FetchArtifact" (id, url, "finalUrl", "statusCode", "contentType", "bodySha256",
            "storageKey", "sizeBytes", "fetchedAt", "robotsAllowed", "renderMode")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now(), %s, %s)
        """,
        (artifact_id, url, final_url, status_code, content_type, digest, f"{digest[:2]}/{digest}.html.gz", len(body), robots_allowed, render_mode),
    )
    return artifact_id, digest


async def start_extraction_run(conn: AsyncConn, artifact_id: str, extractor_version: str) -> str:
    row = await (
        await conn.execute(
            """
            INSERT INTO "ExtractionRun" (id, "fetchArtifactId", "extractorVersion", "startedAt", status)
            VALUES (%s, %s, %s, now(), 'RUNNING')
            ON CONFLICT ("fetchArtifactId", "extractorVersion") DO UPDATE SET "startedAt" = now(), status = 'RUNNING'
            RETURNING id
            """,
            (new_id(), artifact_id, extractor_version),
        )
    ).fetchone()
    assert row is not None
    return str(row["id"])


async def finish_extraction_run(conn: AsyncConn, run_id: str, count: int) -> None:
    await conn.execute(
        'UPDATE "ExtractionRun" SET status = \'COMPLETED\', "candidateCount" = %s, "finishedAt" = now() WHERE id = %s',
        (count, run_id),
    )


async def insert_candidate(
    conn: AsyncConn,
    *,
    organization_id: str,
    artifact_id: str,
    run_id: str,
    company_id: str | None,
    crawl_job_id: str,
    page_url: str,
    candidate: Candidate,
) -> str:
    candidate_id = new_id()
    await conn.execute(
        """
        INSERT INTO "ExtractionCandidate" (id, "organizationId", "companyId", "runId", "fetchArtifactId", kind,
            "rawValue", "normalizedValue", method, selector, snippet, confidence, status, "createdAt",
            category, "personName", "jobTitle", "pageUrl", "crawlJobId")
        VALUES (%s, %s, %s, %s, %s, %s::"CandidateKind", %s, %s, %s, %s, %s, %s, 'PENDING', now(),
            %s::"ContactCategory", %s, %s, %s, %s)
        """,
        (
            candidate_id, organization_id, company_id, run_id, artifact_id, candidate.kind,
            candidate.raw_value, candidate.normalized_value, candidate.method, candidate.selector,
            candidate.snippet, candidate.confidence, candidate.category, candidate.person_name,
            candidate.job_title, page_url, crawl_job_id,
        ),
    )
    return candidate_id


async def is_suppressed(conn: AsyncConn, organization_id: str, normalized: str, domain: str) -> bool:
    row = await (
        await conn.execute(
            """
            SELECT 1 FROM "SuppressionEntry"
            WHERE "liftedAt" IS NULL AND "emailNormalized" IN (%s, '*@' || %s)
              AND ("organizationId" IS NULL OR "organizationId" = %s)
            LIMIT 1
            """,
            (normalized, domain, organization_id),
        )
    ).fetchone()
    return row is not None


async def is_domain_suppressed(conn: AsyncConn, organization_id: str, domain: str) -> bool:
    """Domain-wide suppression is stored as emailNormalized '*@<domain>'."""
    row = await (
        await conn.execute(
            """
            SELECT 1 FROM "SuppressionEntry"
            WHERE "liftedAt" IS NULL AND "emailNormalized" = '*@' || %s
              AND ("organizationId" IS NULL OR "organizationId" = %s)
            LIMIT 1
            """,
            (domain, organization_id),
        )
    ).fetchone()
    return row is not None


async def reject_candidate(conn: AsyncConn, candidate_id: str, reason: str) -> None:
    await conn.execute(
        'UPDATE "ExtractionCandidate" SET status = \'REJECTED\', "rejectReason" = %s, "reviewedAt" = now() WHERE id = %s',
        (reason, candidate_id),
    )


async def _contact_for(
    conn: AsyncConn, organization_id: str, company_id: str, category: str, role_based: bool, page_url: str, confidence: float,
    person_name: str | None = None, job_title: str | None = None,
) -> str:
    if role_based:
        row = await (
            await conn.execute(
                """
                SELECT id FROM "Contact"
                WHERE "companyId" = %s AND type = 'GENERIC_BUSINESS' AND category = %s::"ContactCategory"
                  AND "deletedAt" IS NULL
                ORDER BY "createdAt" LIMIT 1
                """,
                (company_id, category),
            )
        ).fetchone()
        if row:
            await conn.execute(
                'UPDATE "Contact" SET confidence = GREATEST(confidence, %s), "observedAt" = now(), "updatedAt" = now() WHERE id = %s',
                (confidence, row["id"]),
            )
            return str(row["id"])
    contact_id = new_id()
    await conn.execute(
        """
        INSERT INTO "Contact" (id, "organizationId", "companyId", type, category, "isRoleBased", "fullName", "jobTitle",
            "sourceUrl", confidence, status, "observedAt", "createdAt", "updatedAt", tags)
        VALUES (%s, %s, %s, %s::"ContactType", %s::"ContactCategory", %s, %s, %s, %s, %s, 'ACTIVE', now(), now(), now(), '{}')
        """,
        (
            contact_id, organization_id, company_id, "GENERIC_BUSINESS" if role_based else "PERSON", category,
            role_based, person_name, job_title, page_url, confidence,
        ),
    )
    return contact_id


async def promote_candidate(
    conn: AsyncConn,
    *,
    candidate_id: str,
    organization_id: str,
    company_id: str,
    artifact_id: str,
    content_hash: str,
    page_url: str,
    candidate: Candidate,
    is_role: bool,
    local_part: str | None,
    domain: str | None,
    is_free: bool,
    is_disposable: bool,
) -> str:
    """Create/attach the contact with its evidence. Returns the contact id."""
    category = candidate.category or "GENERAL"
    if candidate.kind == "EMAIL":
        assert domain is not None and local_part is not None
        row = await (
            await conn.execute(
                """
                INSERT INTO "EmailAddress" (id, address, normalized, "localPart", domain, status, "isRoleAccount",
                    "isDisposable", "isFreeProvider", "firstSeenAt", "createdAt", "updatedAt")
                VALUES (%s, %s, %s, %s, %s, 'DISCOVERED', %s, %s, %s, now(), now(), now())
                ON CONFLICT (normalized) DO UPDATE SET "updatedAt" = now()
                RETURNING id
                """,
                (new_id(), candidate.raw_value[:320], candidate.normalized_value, local_part, domain, is_role, is_disposable, is_free),
            )
        ).fetchone()
        assert row is not None
        email_id = str(row["id"])
        existing = await (
            await conn.execute(
                'SELECT ce."contactId" FROM "ContactEmail" ce JOIN "Contact" c ON c.id = ce."contactId" WHERE ce."emailId" = %s AND c."companyId" = %s LIMIT 1',
                (email_id, company_id),
            )
        ).fetchone()
        contact_id = (
            str(existing["contactId"])
            if existing
            else await _contact_for(
                conn, organization_id, company_id, category, is_role, page_url, candidate.confidence,
                None if is_role else candidate.person_name, None if is_role else candidate.job_title,
            )
        )
        await conn.execute(
            """
            INSERT INTO "ContactEmail" ("contactId", "emailId", "isPrimary", label, confidence, "createdAt")
            VALUES (%s, %s, true, 'WORK', %s, now()) ON CONFLICT DO NOTHING
            """,
            (contact_id, email_id, candidate.confidence),
        )
        field_name, value, promoted_email = "email", candidate.normalized_value, email_id
    elif candidate.kind == "PHONE":
        contact_id = await _contact_for(conn, organization_id, company_id, category, True, page_url, candidate.confidence)
        await conn.execute(
            'UPDATE "Contact" SET "phoneRaw" = COALESCE("phoneRaw", %s), "phoneE164" = COALESCE("phoneE164", %s), "updatedAt" = now() WHERE id = %s',
            (candidate.raw_value, candidate.normalized_value, contact_id),
        )
        field_name, value, promoted_email = "phone", candidate.normalized_value, None
    else:
        contact_id = await _contact_for(conn, organization_id, company_id, "GENERAL", True, page_url, candidate.confidence)
        await conn.execute(
            'UPDATE "Contact" SET "contactFormUrl" = COALESCE("contactFormUrl", %s), "updatedAt" = now() WHERE id = %s',
            (candidate.normalized_value, contact_id),
        )
        field_name, value, promoted_email = "contact_form_url", candidate.normalized_value, None

    await conn.execute(
        """
        INSERT INTO "SourceEvidence" (id, "organizationId", "companyId", "contactId", "emailId", "fetchArtifactId",
            "pageUrl", "fieldName", "extractedValue", "extractorVersion", method, snippet, "observedAt", "contentHash")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), %s)
        """,
        (
            new_id(), organization_id, company_id, contact_id, promoted_email, artifact_id, page_url, field_name,
            value, candidate.method, candidate.method, candidate.snippet, content_hash,
        ),
    )
    await conn.execute(
        """
        UPDATE "ExtractionCandidate" SET status = 'PROMOTED', "promotedEmailId" = %s, "promotedContactId" = %s,
            "reviewedAt" = now()
        WHERE id = %s
        """,
        (promoted_email, contact_id, candidate_id),
    )
    return contact_id


async def record_page_fact(
    conn: AsyncConn, *, organization_id: str, company_id: str, artifact_id: str, page_url: str, field_name: str, value: str, method: str, content_hash: str
) -> None:
    await conn.execute(
        """
        INSERT INTO "SourceEvidence" (id, "organizationId", "companyId", "fetchArtifactId", "pageUrl", "fieldName",
            "extractedValue", "extractorVersion", method, "observedAt", "contentHash")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now(), %s)
        """,
        (new_id(), organization_id, company_id, artifact_id, page_url, field_name, value[:2000], method, method, content_hash),
    )


async def update_company_after_crawl(
    conn: AsyncConn,
    company_id: str,
    *,
    reachable: bool,
    https: bool | None,
    language: str | None,
    description: str | None,
    technologies: list[str],
    social_profiles: list[str],
    has_contact_page: bool,
    has_careers_page: bool,
) -> None:
    await conn.execute(
        """
        UPDATE "Company" SET
            "websiteStatus" = %s::"WebsiteStatus",
            "httpsEnabled" = COALESCE(%s, "httpsEnabled"),
            "primaryLanguage" = COALESCE("primaryLanguage", %s),
            description = COALESCE(description, %s),
            technologies = CASE WHEN %s::jsonb = '[]'::jsonb THEN technologies ELSE %s::jsonb END,
            "socialProfiles" = CASE WHEN %s::jsonb = '[]'::jsonb THEN "socialProfiles" ELSE %s::jsonb END,
            "hasContactPage" = %s, "hasCareersPage" = %s,
            "lastCrawledAt" = now(), "lastSeenAt" = CASE WHEN %s THEN now() ELSE "lastSeenAt" END,
            "updatedAt" = now()
        WHERE id = %s
        """,
        (
            "REACHABLE" if reachable else "UNREACHABLE",
            https,
            language,
            description,
            json.dumps(technologies), json.dumps(technologies),
            json.dumps(social_profiles), json.dumps(social_profiles),
            has_contact_page,
            has_careers_page,
            reachable,
            company_id,
        ),
    )


async def touch_domain(conn: AsyncConn, domain_id: str | None, robots_hash: str | None) -> None:
    if not domain_id:
        return
    await conn.execute(
        """
        UPDATE "Domain" SET "lastCrawledAt" = now(), "nextCrawlAt" = now() + interval '30 days',
            "robotsHash" = COALESCE(%s, "robotsHash"), "updatedAt" = now()
        WHERE id = %s
        """,
        (robots_hash, domain_id),
    )


async def cooldown_domain(conn: AsyncConn, domain_id: str | None, hours: int = 24) -> None:
    if not domain_id:
        return
    await conn.execute(
        'UPDATE "Domain" SET "cooldownUntil" = %s, "updatedAt" = now() WHERE id = %s',
        (datetime.now(UTC) + timedelta(hours=hours), domain_id),
    )


# Share of finished crawls that must be refusals before a project pauses.
BLOCKED_SHARE = 0.5


async def pause_project_if_blocked(conn: AsyncConn, project_id: str | None, threshold: int) -> bool:
    """Spec 11: stop on repeated access failures. Pauses the project for a person to look at.

    A project spans many independent sites, and some always refuse crawlers (403, robots.txt).
    Those are skipped one by one. The project pauses only when refusals are both numerous
    (``threshold``) and the norm (``BLOCKED_SHARE`` of finished crawls), which points at us
    being blocked rather than at a few sites' choices."""
    if not project_id:
        return False
    row = await (
        await conn.execute(
            """
            SELECT count(*) FILTER (WHERE status = 'BLOCKED') AS blocked,
                   count(*) FILTER (WHERE status IN ('SUCCEEDED', 'PARTIAL', 'FAILED', 'BLOCKED')) AS finished
            FROM "CrawlJob" WHERE "projectId" = %s
            """,
            (project_id,),
        )
    ).fetchone()
    if not row:
        return False
    blocked, finished = int(row["blocked"]), int(row["finished"])
    if blocked >= threshold and blocked >= BLOCKED_SHARE * finished:
        result = await conn.execute(
            """
            UPDATE "DiscoveryProject" SET status = 'PAUSED',
                "lastError" = %s, "updatedAt" = now()
            WHERE id = %s AND status = 'RUNNING'
            """,
            (
                f"Paused automatically: {blocked} of {finished} sites refused access (threshold {threshold}, "
                f"{int(BLOCKED_SHARE * 100)}% of finished crawls). Review the policy stops before resuming.",
                project_id,
            ),
        )
        return (result.rowcount or 0) > 0
    return False


# ---------------------------------------------------------------------------
# Discovery runs
# ---------------------------------------------------------------------------


@dataclass
class DiscoveryRun:
    id: str
    organization_id: str
    project_id: str
    source_id: str
    attempt_count: int
    max_attempts: int
    query: dict[str, Any]
    adapter: str | None
    source_type: str
    source_config: dict[str, Any]
    source_policy: dict[str, Any]
    max_companies: int
    settings: dict[str, Any]


async def claim_discovery_run(conn: AsyncConn) -> DiscoveryRun | None:
    row = await (
        await conn.execute(
            """
            UPDATE "DiscoveryRun" AS r
            SET status = 'RUNNING', "attemptCount" = r."attemptCount" + 1, "startedAt" = now(), "heartbeatAt" = now()
            WHERE r.id = (
                SELECT q.id FROM "DiscoveryRun" q
                JOIN "DiscoveryProject" p ON p.id = q."projectId"
                WHERE q.status = 'QUEUED' AND q."scheduledFor" <= now() AND p.status = 'RUNNING'
                ORDER BY q."scheduledFor" ASC
                LIMIT 1
                FOR UPDATE OF q SKIP LOCKED
            )
            RETURNING r.id, r."organizationId", r."projectId", r."sourceId", r."attemptCount", r."maxAttempts", r.query
            """
        )
    ).fetchone()
    if row is None:
        await conn.commit()
        return None
    source = await (
        await conn.execute(
            """
            SELECT s.adapter, s."sourceType", s.config, s."policyStatus", s.enabled, s.permitted,
                   s."automatedAccessAllowed", s."rateLimitJson", s."licenceName", s."policyVersion", s."baseUrl",
                   p."maxCompanies", p.settings
            FROM "Source" s, "DiscoveryProject" p
            WHERE s.id = %s AND p.id = %s
            """,
            (row["sourceId"], row["projectId"]),
        )
    ).fetchone()
    await conn.commit()
    assert source is not None
    return DiscoveryRun(
        id=row["id"],
        organization_id=row["organizationId"],
        project_id=row["projectId"],
        source_id=row["sourceId"],
        attempt_count=row["attemptCount"],
        max_attempts=row["maxAttempts"],
        query=row["query"] or {},
        adapter=source["adapter"],
        source_type=source["sourceType"],
        source_config=source["config"] or {},
        source_policy={
            "policyStatus": source["policyStatus"],
            "enabled": source["enabled"],
            "permitted": source["permitted"],
            "automatedAccessAllowed": source["automatedAccessAllowed"],
            "rateLimit": source["rateLimitJson"] or {},
            "licence": source["licenceName"],
            "policyVersion": source["policyVersion"],
            "baseUrl": source["baseUrl"],
        },
        max_companies=source["maxCompanies"],
        settings=source["settings"] or {},
    )


async def finish_discovery_run(
    conn: AsyncConn,
    run_id: str,
    status: str,
    *,
    found: int,
    metrics: dict[str, Any] | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    policy_stop_reason: str | None = None,
    retry_at: datetime | None = None,
) -> None:
    await conn.execute(
        """
        UPDATE "DiscoveryRun" SET status = %s::"RunJobStatus", "candidatesFound" = %s, metrics = %s,
            "errorCode" = %s, "errorMessage" = %s, "policyStopReason" = %s,
            "nextRetryAt" = %s, "scheduledFor" = COALESCE(%s, "scheduledFor"),
            "finishedAt" = CASE WHEN %s = 'QUEUED' THEN NULL ELSE now() END
        WHERE id = %s
        """,
        (
            status, found, Jsonb(metrics or {}), error_code, (error_message or "")[:1000] or None, policy_stop_reason,
            retry_at, retry_at, status, run_id,
        ),
    )


async def insert_company_candidates(conn: AsyncConn, run: DiscoveryRun, rows: list[dict[str, Any]]) -> int:
    inserted = 0
    for row in rows:
        result = await conn.execute(
            """
            INSERT INTO "CompanyCandidate" (id, "organizationId", "projectId", "sourceId", "runId", "sourceRecordId",
                "sourceUrl", name, website, "registrationNumber", "legalForm", description, "countryIso2", "regionName",
                "cityName", "postalCode", "addressLine", latitude, longitude, phone, "industryLabel", "industryCodes",
                "employeeRange", "foundedYear", raw, licence, status, "createdAt")
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                'PENDING', now())
            ON CONFLICT ("projectId", "sourceId", "sourceRecordId") DO NOTHING
            """,
            (
                new_id(), run.organization_id, run.project_id, run.source_id, run.id, row["source_record_id"],
                row.get("source_url"), row["name"], row.get("website"), row.get("registration_number"), row.get("legal_form"),
                row.get("description"), row.get("country"), row.get("region"), row.get("city"), row.get("postal_code"),
                row.get("address"), row.get("latitude"), row.get("longitude"), row.get("phone"), row.get("industry_label"),
                Jsonb(row.get("industry_codes") or []), row.get("employee_range"), row.get("founded_year"),
                Jsonb(row.get("raw") or {}), row.get("licence"),
            ),
        )
        inserted += result.rowcount or 0
    return inserted
