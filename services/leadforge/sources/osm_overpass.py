"""OpenStreetMap via the Overpass API (ODbL 1.0).

Finds businesses with a website tag inside the project's areas. Usage rules:
  * disabled until an operator approves the source policy (it ships UNREVIEWED);
  * prefer a self-hosted Overpass instance (``config.endpoint``) for volume;
  * one query per area, spaced by the source rate limit, with a server timeout;
  * ODbL requires attribution ("© OpenStreetMap contributors") and share-alike
    for derived databases; the licence is stored on every record.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..net import PolicyStop, make_client
from ..safety import validate_url
from .base import CompanyRecord, Scope, ScopeArea, SourceAdapter, SourcePolicy

DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter"

# Internal sector code -> OSM tag filters. Unlisted sectors fall back to generic business tags.
SECTOR_TAGS: dict[str, list[str]] = {
    "it-software": ['["office"="it"]', '["office"="telecommunication"]'],
    "construction": ['["craft"~"builder|carpenter|electrician|plumber|roofer|painter|tiler|hvac|insulation|plasterer"]', '["office"="construction_company"]'],
    "manufacturing": ['["industrial"]', '["man_made"="works"]', '["craft"~"metal_construction|joiner|electronics_repair"]'],
    "healthcare": ['["healthcare"]', '["amenity"~"clinic|dentist|doctors"]'],
    "education": ['["amenity"~"school|college|university|driving_school|language_school"]'],
    "retail-ecommerce": ['["shop"]'],
    "logistics-transport": ['["office"="logistics"]', '["industrial"="warehouse"]', '["office"="moving_company"]'],
    "finance-insurance": ['["office"~"financial|insurance|accountant|tax_advisor"]', '["amenity"="bank"]'],
    "real-estate": ['["office"~"estate_agent|property_management"]'],
    "hospitality-tourism": ['["tourism"~"hotel|hostel|guest_house"]', '["amenity"~"restaurant|cafe"]', '["office"="travel_agent"]'],
    "energy-utilities": ['["office"="energy_supplier"]', '["power"="plant"]'],
    "professional-services": ['["office"~"lawyer|accountant|consulting|architect|engineer|advertising_agency|employment_agency"]'],
    "agriculture-food": ['["craft"~"brewery|winery|bakery|confectionery"]', '["landuse"="farmyard"]'],
    "automotive": ['["shop"~"car|car_repair|car_parts|tyres"]'],
    "media-communications": ['["office"~"newspaper|publisher|telecommunication"]'],
    "wholesale-distribution": ['["shop"="wholesale"]', '["office"="company"]["company"="wholesale"]'],
}
GENERIC = ['["office"]', '["craft"]', '["shop"]', '["industrial"]']


def _filters(scope: Scope) -> list[str]:
    sectors = {code.split(".")[0] for code in scope.sector_codes}
    chosen: list[str] = []
    for sector in sorted(sectors):
        chosen.extend(SECTOR_TAGS.get(sector, []))
    return chosen or GENERIC


def _area_clause(area: ScopeArea) -> tuple[str, str] | None:
    """Return (prelude, selector-suffix) for one area."""
    if area.level in {"CITY", "POINT"} and area.latitude is not None and area.longitude is not None:
        radius = int((area.radius_km or 10) * 1000)
        return "", f"(around:{radius},{area.latitude},{area.longitude})"
    if area.level in {"COUNTRY", "REGION", "POSTAL"} and area.country:
        if area.level == "REGION" and area.name:
            escaped = area.name.replace('"', "")
            return f'area["ISO3166-1"="{area.country}"]->.c;area(area.c)["name"="{escaped}"]["boundary"="administrative"]->.a;', "(area.a)"
        return f'area["ISO3166-1"="{area.country}"][admin_level=2]->.a;', "(area.a)"
    return None


def build_query(area: ScopeArea, filters: list[str], limit: int, timeout: int) -> str | None:
    clause = _area_clause(area)
    if clause is None:
        return None
    prelude, suffix = clause
    parts = []
    for tag in filters:
        for kind in ("node", "way"):
            parts.append(f'{kind}{tag}["name"]["website"]{suffix};')
            parts.append(f'{kind}{tag}["name"]["contact:website"]{suffix};')
    return f"[out:json][timeout:{timeout}][maxsize:268435456];{prelude}({''.join(parts)});out center tags {limit};"


def _label(tags: dict[str, str]) -> str | None:
    for key in ("craft", "office", "shop", "industrial", "healthcare", "amenity", "tourism"):
        if key in tags:
            return f"{key}={tags[key]}"
    return None


def to_record(element: dict[str, Any], licence: str | None) -> CompanyRecord | None:
    tags: dict[str, str] = element.get("tags") or {}
    name = tags.get("name")
    website = tags.get("website") or tags.get("contact:website")
    if not name or not website:
        return None
    lat = element.get("lat") or (element.get("center") or {}).get("lat")
    lon = element.get("lon") or (element.get("center") or {}).get("lon")
    kind = element.get("type", "node")
    street = " ".join(x for x in (tags.get("addr:street"), tags.get("addr:housenumber")) if x)
    try:
        return CompanyRecord(
            source_record_id=f"{kind}/{element.get('id')}",
            source_url=f"https://www.openstreetmap.org/{kind}/{element.get('id')}",
            name=name[:300],
            website=website,
            country=(tags.get("addr:country") or None),
            city=tags.get("addr:city"),
            postal_code=tags.get("addr:postcode"),
            address=street or None,
            phone=tags.get("phone") or tags.get("contact:phone"),
            latitude=lat,
            longitude=lon,
            industry_label=_label(tags),
            raw={"tags": tags},
            licence=licence or "ODbL 1.0",
        )
    except ValueError:
        return None


class OverpassAdapter(SourceAdapter):
    source_name = "osm_overpass"

    async def search(self, query: dict[str, Any], scope: Scope, filters: dict[str, Any], limit: int) -> AsyncIterator[CompanyRecord]:
        if scope.worldwide:
            raise PolicyStop("overpass_requires_bounded_area")
        endpoint = str(self.config.get("endpoint") or self.policy.get("baseUrl") or DEFAULT_ENDPOINT)
        validate_url(endpoint)
        timeout = int(self.config.get("timeoutSeconds") or 60)
        rpm = int((self.policy.get("rateLimit") or {}).get("requestsPerMinute") or 2)
        tag_filters = _filters(scope)
        emitted = 0
        seen: set[str] = set()
        async with make_client(timeout=timeout + 15) as client:
            for index, area in enumerate(scope.areas):
                q = build_query(area, tag_filters, max(1, limit - emitted), timeout)
                if q is None:
                    continue
                if index:
                    await asyncio.sleep(60 / max(rpm, 1))
                response = await client.post(endpoint, data={"data": q})
                if response.status_code in {429, 403}:
                    raise PolicyStop(f"overpass_http_{response.status_code}")
                if response.status_code >= 500:
                    raise httpx.HTTPStatusError("overpass server error", request=response.request, response=response)
                response.raise_for_status()
                for element in response.json().get("elements", []):
                    record = to_record(element, self.policy.get("licence"))
                    if record is None or record.source_record_id in seen:
                        continue
                    if record.country is None and area.country:
                        record.country = area.country
                    seen.add(record.source_record_id)
                    yield record
                    emitted += 1
                    if emitted >= limit:
                        return

    async def get_policy(self) -> SourcePolicy:
        return SourcePolicy(
            source_type="DIRECTORY",
            terms_url="https://wiki.openstreetmap.org/wiki/Overpass_API",
            licence="ODbL 1.0",
            permitted_use="Open data under ODbL; attribution and share-alike apply to derived databases.",
            attribution="© OpenStreetMap contributors",
            requests_per_minute=int((self.policy.get("rateLimit") or {}).get("requestsPerMinute") or 2),
            retention_days=None,
            automated_access=bool(self.policy.get("automatedAccessAllowed")),
            commercial_reuse=bool(self.policy.get("commercialReuseAllowed")),
        )
