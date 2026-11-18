"""Raw artifact retention (spec sections 11 and 15): purge old crawl bodies.

Evidence rows keep their page URL and content hash after the raw body is
gone, so provenance stays inspectable while raw personal data is minimized.
"""

from __future__ import annotations

from pathlib import Path

from .config import settings
from .store import AsyncConn


async def purge_artifacts(conn: AsyncConn, days: int | None = None, batch: int = 500) -> int:
    keep_days = days if days is not None else settings.artifact_retention_days
    rows = await (
        await conn.execute(
            """
            SELECT id, "storageKey", "bodySha256" FROM "FetchArtifact"
            WHERE "fetchedAt" < now() - make_interval(days => %s)
            ORDER BY "fetchedAt" LIMIT %s
            """,
            (keep_days, batch),
        )
    ).fetchall()
    if not rows:
        return 0
    ids = [r["id"] for r in rows]
    # Promoted contacts keep their SourceEvidence (URL + hash); pending candidates on purged pages go too.
    await conn.execute('DELETE FROM "FetchArtifact" WHERE id = ANY(%s)', (ids,))
    still_used = {
        r["bodySha256"]
        for r in await (
            await conn.execute('SELECT DISTINCT "bodySha256" FROM "FetchArtifact" WHERE "bodySha256" = ANY(%s)', ([r["bodySha256"] for r in rows],))
        ).fetchall()
    }
    await conn.commit()
    base = Path(settings.artifact_dir)
    for row in rows:
        if row["bodySha256"] in still_used:
            continue
        path = base / row["storageKey"]
        if path.is_file():
            path.unlink()
    return len(rows)
