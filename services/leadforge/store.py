"""Postgres persistence for the crawl/extract worker."""

from __future__ import annotations

import gzip
import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from .config import settings
from .extract import Candidate

DbConnection = psycopg.Connection[dict[str, Any]]


@dataclass
class CrawlTarget:
    id: str
    url: str
    domain_id: str | None
    organization_id: str
    project_id: str | None
    attempts: int
    depth: int


def connect() -> DbConnection:
    return psycopg.connect(settings.database_url, row_factory=dict_row)


def claim_target(conn: DbConnection) -> CrawlTarget | None:
    row = conn.execute(
        """
        UPDATE "CrawlTarget" AS t
        SET status = 'RUNNING', attempts = t.attempts + 1, "updatedAt" = now()
        WHERE t.id = (
            SELECT id FROM "CrawlTarget"
            WHERE status = 'QUEUED' AND "scheduledFor" <= now()
            ORDER BY priority ASC, "scheduledFor" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING t.id, t.url, t."domainId", t."organizationId", t."projectId",
                  t.attempts, t.depth
        """,
    ).fetchone()
    if row is None:
        return None
    return CrawlTarget(
        id=row["id"],
        url=row["url"],
        domain_id=row["domainId"],
        organization_id=row["organizationId"],
        project_id=row["projectId"],
        attempts=row["attempts"],
        depth=row["depth"],
    )


def mark_target(
    conn: DbConnection,
    target_id: str,
    status: str,
    *,
    error: str | None = None,
    retry: bool = False,
) -> None:
    if retry:
        conn.execute(
            """
            UPDATE "CrawlTarget"
            SET status = 'QUEUED', "lastError" = %s, "scheduledFor" = now() + interval '5 minutes',
                "updatedAt" = now()
            WHERE id = %s
            """,
            (error, target_id),
        )
        return

    conn.execute(
        """
        UPDATE "CrawlTarget"
        SET status = %s::"CrawlTargetStatus", "lastError" = %s, "updatedAt" = now()
        WHERE id = %s
        """,
        (status, error, target_id),
    )


def save_artifact(
    conn: DbConnection,
    *,
    url: str,
    final_url: str,
    status_code: int,
    content_type: str | None,
    body: bytes,
    render_mode: str = "HTTP",
    robots_allowed: bool = True,
) -> tuple[str, str]:
    digest = hashlib.sha256(body).hexdigest()
    directory = Path(settings.artifact_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{digest}.html.gz"
    if not path.exists():
        with gzip.open(path, "wb") as handle:
            handle.write(body)

    artifact_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO "FetchArtifact"
            (id, url, "finalUrl", "statusCode", "contentType", "bodySha256", "storageKey",
             "sizeBytes", "fetchedAt", "robotsAllowed", "renderMode")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now(), %s, %s)
        ON CONFLICT DO NOTHING
        """,
        (
            artifact_id,
            url,
            final_url,
            status_code,
            content_type,
            digest,
            f"{digest}.html.gz",
            len(body),
            robots_allowed,
            render_mode,
        ),
    )
    return artifact_id, digest


def company_for_domain(conn: DbConnection, domain_id: str | None) -> dict[str, Any] | None:
    if not domain_id:
        return None
    return conn.execute(
        """
        SELECT c.id, c.name, c."countryCode"
        FROM "CompanyDomain" cd
        JOIN "Company" c ON c.id = cd."companyId"
        WHERE cd."domainId" = %s
        LIMIT 1
        """,
        (domain_id,),
    ).fetchone()


def upsert_run(
    conn: DbConnection, artifact_id: str, extractor_version: str
) -> str:
    row = conn.execute(
        """
        INSERT INTO "ExtractionRun" (id, "fetchArtifactId", "extractorVersion", "startedAt", status)
        VALUES (%s, %s, %s, now(), 'RUNNING')
        ON CONFLICT ("fetchArtifactId", "extractorVersion")
        DO UPDATE SET "startedAt" = now(), status = 'RUNNING'
        RETURNING id
        """,
        (str(uuid.uuid4()), artifact_id, extractor_version),
    ).fetchone()
    if row is None:
        raise RuntimeError("failed to create extraction run")
    return str(row["id"])


def finish_run(conn: DbConnection, run_id: str, count: int) -> None:
    conn.execute(
        """
        UPDATE "ExtractionRun"
        SET status = 'COMPLETED', "candidateCount" = %s, "finishedAt" = now()
        WHERE id = %s
        """,
        (count, run_id),
    )


def insert_candidate(
    conn: DbConnection,
    *,
    organization_id: str,
    artifact_id: str,
    run_id: str,
    company_id: str | None,
    candidate: Candidate,
) -> None:
    conn.execute(
        """
        INSERT INTO "ExtractionCandidate"
            (id, "organizationId", "companyId", "runId", "fetchArtifactId", kind,
             "rawValue", "normalizedValue", method, selector, snippet, confidence,
             status, "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s::"CandidateKind", %s, %s, %s, %s, %s, %s, 'PENDING', now())
        """,
        (
            str(uuid.uuid4()),
            organization_id,
            company_id,
            run_id,
            artifact_id,
            candidate.kind,
            candidate.raw_value,
            candidate.normalized_value,
            candidate.method,
            candidate.selector,
            candidate.snippet,
            candidate.confidence,
        ),
    )


def touch_domain(conn: DbConnection, domain_id: str | None, robots_hash: str | None) -> None:
    if not domain_id:
        return
    conn.execute(
        """
        UPDATE "Domain"
        SET "lastCrawledAt" = now(), "nextCrawlAt" = now() + interval '30 days',
            "robotsHash" = COALESCE(%s, "robotsHash"), "updatedAt" = now()
        WHERE id = %s
        """,
        (robots_hash, domain_id),
    )


def cooldown_domain(conn: DbConnection, domain_id: str | None, hours: int = 24) -> None:
    if not domain_id:
        return
    until = datetime.now(UTC) + timedelta(hours=hours)
    conn.execute(
        'UPDATE "Domain" SET "cooldownUntil" = %s, "updatedAt" = now() WHERE id = %s',
        (until, domain_id),
    )


def enqueue_contact_pages(
    conn: DbConnection,
    *,
    organization_id: str,
    project_id: str | None,
    domain_id: str | None,
    links: list[str],
    depth: int,
    max_pages: int,
) -> int:
    if not project_id or depth >= 3:
        return 0

    row = conn.execute(
        'SELECT count(*) AS n FROM "CrawlTarget" WHERE "projectId" = %s',
        (project_id,),
    ).fetchone()
    existing = int(row["n"]) if row else 0
    if existing >= max_pages:
        return 0

    created = 0
    for link in links[:3]:
        url_hash = hashlib.sha256(link.encode()).hexdigest()
        inserted = conn.execute(
            """
            INSERT INTO "CrawlTarget"
                (id, "organizationId", "projectId", "domainId", url, "urlHash", priority,
                 depth, status, "createdAt", "updatedAt")
            VALUES (%s, %s, %s, %s, %s, %s, 50, %s, 'QUEUED', now(), now())
            ON CONFLICT ("projectId", "urlHash") DO NOTHING
            RETURNING id
            """,
            (
                str(uuid.uuid4()),
                organization_id,
                project_id,
                domain_id,
                link,
                url_hash,
                depth + 1,
            ),
        ).fetchone()
        if inserted:
            created += 1
    return created
