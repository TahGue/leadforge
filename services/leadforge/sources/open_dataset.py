"""Open registry / dataset export placed on disk by the operator (spec section 10, priority 2).

Reads CSV or JSON Lines from ``settings.imports_dir``. The operator records the
dataset's licence and terms on the Source before approving it. Column names are
mapped through ``config.columns`` (defaults cover common registry exports).
"""

from __future__ import annotations

import csv
import json
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

from ..config import settings
from .base import CompanyRecord, IndustryCode, Scope, SourceAdapter, SourcePolicy

DEFAULT_COLUMNS: dict[str, list[str]] = {
    "source_record_id": ["id", "registry_id", "organisation_number", "orgnr", "org_nr", "company_number", "registration_number"],
    "name": ["name", "company_name", "legal_name", "foretagsnamn", "firma"],
    "registration_number": ["registration_number", "organisation_number", "orgnr", "org_nr", "company_number", "vat"],
    "legal_form": ["legal_form", "company_type", "bolagsform", "rechtsform"],
    "website": ["website", "url", "homepage", "webbplats"],
    "country": ["country", "country_code", "land"],
    "region": ["region", "county", "lan", "state"],
    "city": ["city", "town", "postort", "ort", "municipality", "kommun"],
    "postal_code": ["postal_code", "postcode", "zip", "postnummer"],
    "address": ["address", "street", "gatuadress", "adress"],
    "phone": ["phone", "telephone", "telefon"],
    "industry_code": ["nace", "sni", "nace_code", "sni_code", "industry_code"],
    "industry_label": ["industry", "sector", "branch", "bransch", "nace_label"],
    "employee_range": ["employees", "employee_range", "size", "anstallda"],
    "founded_year": ["founded", "founded_year", "registration_year", "registrerad"],
    "latitude": ["lat", "latitude"],
    "longitude": ["lon", "lng", "longitude"],
}


def _resolve_path(path: str) -> Path:
    base = Path(settings.imports_dir).resolve()
    target = (base / path.removeprefix("data/imports/")).resolve()
    if base not in target.parents and target != base:
        raise ValueError("dataset path must be inside the imports directory")
    if not target.is_file():
        raise FileNotFoundError(f"dataset not found: {target.name}")
    return target


def _rows(path: Path, fmt: str) -> Iterator[dict[str, Any]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        if fmt == "jsonl":
            for line in handle:
                line = line.strip()
                if line:
                    yield json.loads(line)
        else:
            sample = handle.read(4096)
            handle.seek(0)
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t") if sample else csv.excel
            yield from csv.DictReader(handle, dialect=dialect)


def _pick(row: dict[str, Any], keys: list[str]) -> str | None:
    lowered = {str(k).strip().lower(): v for k, v in row.items()}
    for key in keys:
        value = lowered.get(key)
        if value not in (None, ""):
            return str(value).strip()
    return None


NACE_SECTIONS: dict[str, tuple[int, int]] = {
    "A": (1, 3), "B": (5, 9), "C": (10, 33), "D": (35, 35), "E": (36, 39), "F": (41, 43), "G": (45, 47),
    "H": (49, 53), "I": (55, 56), "J": (58, 63), "K": (64, 66), "L": (68, 68), "M": (69, 75), "N": (77, 82),
    "O": (84, 84), "P": (85, 85), "Q": (86, 88), "R": (90, 93), "S": (94, 96), "T": (97, 98), "U": (99, 99),
}


def nace_matches(wanted: str, have: str) -> bool:
    """Does taxonomy code ``wanted`` ("C", "J62", "43.21") cover a record's code ``have`` ("4321", "43.21")?"""
    wanted = wanted.upper().strip()
    digits = have.replace(".", "").strip().lstrip("ABCDEFGHIJKLMNOPQRSTU")
    if wanted in NACE_SECTIONS:
        if len(digits) < 2 or not digits[:2].isdigit():
            return False
        low, high = NACE_SECTIONS[wanted]
        return low <= int(digits[:2]) <= high
    wanted_digits = wanted.lstrip("ABCDEFGHIJKLMNOPQRSTU").replace(".", "")
    return bool(wanted_digits) and digits.startswith(wanted_digits)


def _in_scope(record: CompanyRecord, scope: Scope) -> bool:
    if scope.countries and record.country and record.country not in scope.countries:
        return False
    if scope.nace_codes and record.industry_codes:
        return any(nace_matches(w, c.code) for w in scope.nace_codes for c in record.industry_codes)
    return True


class OpenDatasetAdapter(SourceAdapter):
    source_name = "open_dataset"

    async def search(self, query: dict[str, Any], scope: Scope, filters: dict[str, Any], limit: int) -> AsyncIterator[CompanyRecord]:
        path = _resolve_path(str(query.get("path") or self.config.get("path") or ""))
        fmt = str(query.get("format") or self.config.get("format") or ("jsonl" if path.suffix == ".jsonl" else "csv"))
        columns = {**DEFAULT_COLUMNS, **{k: [v] if isinstance(v, str) else v for k, v in (self.config.get("columns") or {}).items()}}
        default_country = self.config.get("country")
        scheme = str(self.config.get("industryScheme") or "NACE").upper()
        emitted = 0
        for index, row in enumerate(_rows(path, fmt)):
            name = _pick(row, columns["name"])
            if not name:
                continue
            code = _pick(row, columns["industry_code"])
            founded = _pick(row, columns["founded_year"])
            lat = _pick(row, columns["latitude"])
            lon = _pick(row, columns["longitude"])
            try:
                record = CompanyRecord(
                    source_record_id=_pick(row, columns["source_record_id"]) or f"row-{index + 1}",
                    name=name,
                    source_url=self.policy.get("baseUrl"),
                    website=_pick(row, columns["website"]),
                    registration_number=_pick(row, columns["registration_number"]),
                    legal_form=_pick(row, columns["legal_form"]),
                    country=(_pick(row, columns["country"]) or default_country or None),
                    region=_pick(row, columns["region"]),
                    city=_pick(row, columns["city"]),
                    postal_code=_pick(row, columns["postal_code"]),
                    address=_pick(row, columns["address"]),
                    phone=_pick(row, columns["phone"]),
                    industry_label=_pick(row, columns["industry_label"]),
                    industry_codes=[IndustryCode(scheme=scheme if scheme in {"NACE", "SNI", "ISIC", "NAICS"} else "NACE", code=code)] if code else [],
                    employee_range=_pick(row, columns["employee_range"]),
                    founded_year=int(founded[:4]) if founded and founded[:4].isdigit() else None,
                    latitude=float(lat) if lat else None,
                    longitude=float(lon) if lon else None,
                    raw={k: v for k, v in row.items() if v not in (None, "")},
                    licence=self.policy.get("licence"),
                )
            except (ValueError, TypeError):
                continue
            if not _in_scope(record, scope):
                continue
            yield record
            emitted += 1
            if emitted >= limit:
                return

    async def get_policy(self) -> SourcePolicy:
        return SourcePolicy(
            source_type="DATASET",
            terms_url=self.policy.get("termsUrl"),
            licence=self.policy.get("licence"),
            permitted_use="As recorded on the source by the reviewing operator.",
            attribution=self.policy.get("attribution"),
            requests_per_minute=0,
            retention_days=self.policy.get("retentionDays"),
            automated_access=bool(self.policy.get("automatedAccessAllowed")),
            commercial_reuse=bool(self.policy.get("commercialReuseAllowed")),
        )
