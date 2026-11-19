"""Load a project's geographic and industry scope for source adapters."""

from __future__ import annotations

from ..store import AsyncConn
from .base import Scope, ScopeArea


async def load_scope(conn: AsyncConn, project_id: str) -> Scope:
    project = await (
        await conn.execute('SELECT "geographicMode" FROM "DiscoveryProject" WHERE id = %s', (project_id,))
    ).fetchone()
    rows = await (
        await conn.execute(
            """
            SELECT l.level, l."continentCode", COALESCE(l."countryIso2", r."countryIso2", c."countryIso2") AS country,
                   COALESCE(c.name, r.name) AS name, COALESCE(c.latitude, l.latitude) AS latitude,
                   COALESCE(c.longitude, l.longitude) AS longitude, l."radiusKm", l."postalPrefix", l."includeNearby"
            FROM "DiscoveryLocation" l
            LEFT JOIN "AdminRegion" r ON r.id = l."regionId"
            LEFT JOIN "City" c ON c.id = l."cityId"
            WHERE l."projectId" = %s AND l.mode = 'INCLUDE'
            """,
            (project_id,),
        )
    ).fetchall()
    areas: list[ScopeArea] = []
    countries: set[str] = set()
    continents: list[str] = []
    for row in rows:
        level = row["level"]
        if level == "CONTINENT":
            continents.append(row["continentCode"])
            areas.append(ScopeArea(level=level, name=row["continentCode"]))
            continue
        if row["country"]:
            countries.add(row["country"])
        radius = row["radiusKm"]
        if level == "CITY":
            radius = radius or (25.0 if row["includeNearby"] else 10.0)
        areas.append(
            ScopeArea(
                level=level,
                country=row["country"],
                name=row["name"],
                latitude=row["latitude"],
                longitude=row["longitude"],
                radius_km=radius,
                postal_prefix=row["postalPrefix"],
            )
        )
    if continents:
        for row in await (
            await conn.execute('SELECT iso2 FROM "Country" WHERE "continentCode" = ANY(%s)', (continents,))
        ).fetchall():
            countries.add(row["iso2"])

    codes = await (
        await conn.execute(
            """
            WITH RECURSIVE tree AS (
                SELECT i.id, i.code FROM "Industry" i
                JOIN "DiscoveryIndustryFilter" f ON f."industryId" = i.id
                WHERE f."projectId" = %s AND f.mode = 'INCLUDE'
                UNION
                SELECT c.id, c.code FROM "Industry" c JOIN tree t ON c."parentId" = t.id
            )
            SELECT DISTINCT t.code AS sector, e.code AS nace
            FROM tree t LEFT JOIN "IndustryExternalCode" e ON e."industryId" = t.id AND e.scheme = 'NACE'
            """,
            (project_id,),
        )
    ).fetchall()
    keywords = await (
        await conn.execute(
            'SELECT keyword FROM "DiscoveryKeyword" WHERE "projectId" = %s AND mode = \'INCLUDE\'', (project_id,)
        )
    ).fetchall()
    worldwide = (project or {}).get("geographicMode") == "WORLDWIDE" or not areas
    return Scope(
        worldwide=worldwide,
        areas=[] if worldwide else areas,
        countries=[] if worldwide else sorted(countries),
        nace_codes=sorted({r["nace"] for r in codes if r["nace"]}),
        sector_codes=sorted({r["sector"] for r in codes}),
        keywords=[r["keyword"] for r in keywords],
    )
