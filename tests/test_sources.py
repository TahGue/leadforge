"""Source adapters: domain lists, open datasets, Overpass query building and parsing."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from leadforge.config import settings
from leadforge.discovery import policy_refusal
from leadforge.sources import get_adapter
from leadforge.sources.base import CompanyRecord, Scope, ScopeArea
from leadforge.sources.domain_list import registrable_domain
from leadforge.sources.open_dataset import nace_matches
from leadforge.sources.osm_overpass import build_query, to_record
from leadforge.store import DiscoveryRun


async def collect(adapter: object, query: dict[str, object], scope: Scope, limit: int = 100) -> list[CompanyRecord]:
    return [r async for r in adapter.search(query, scope, {}, limit)]  # type: ignore[attr-defined]


def test_registrable_domain() -> None:
    assert registrable_domain("https://www.Shop.Example.co.uk/path?q=1") == "example.co.uk"
    assert registrable_domain("not a domain") is None


def test_domain_list_dedupes_and_normalizes() -> None:
    adapter = get_adapter("domain_list", {}, {})
    records = asyncio.run(collect(adapter, {"domains": ["acme.se", "https://www.acme.se/", "beta.de", "bad"]}, Scope(worldwide=True)))
    assert [r.source_record_id for r in records] == ["acme.se", "beta.de"]
    assert records[0].website == "https://acme.se/"


def test_open_dataset_reads_csv_and_filters_scope(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "imports_dir", str(tmp_path))
    (tmp_path / "registry.csv").write_text(
        "orgnr;name;city;country;sni;website\n"
        "556000-0001;Bygg AB;Göteborg;SE;41200;bygg.se\n"
        "556000-0002;Mjukvara AB;Stockholm;SE;62010;mjuk.se\n"
        "556000-0003;Hamburg GmbH;Hamburg;DE;41200;hh.de\n",
        encoding="utf-8",
    )
    adapter = get_adapter("open_dataset", {"path": "registry.csv", "industryScheme": "SNI"}, {"licence": "CC0"})
    scope = Scope(worldwide=False, countries=["SE"], nace_codes=["41"])
    records = asyncio.run(collect(adapter, {}, scope))
    assert [r.name for r in records] == ["Bygg AB"]
    assert records[0].registration_number == "556000-0001"
    assert records[0].industry_codes[0].code == "41200"
    assert records[0].licence == "CC0"


def test_open_dataset_rejects_path_traversal(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "imports_dir", str(tmp_path))
    adapter = get_adapter("open_dataset", {"path": "../../etc/passwd"}, {})
    with pytest.raises(ValueError):
        asyncio.run(collect(adapter, {}, Scope(worldwide=True)))


def test_nace_matches_sections_and_prefixes() -> None:
    assert nace_matches("C", "25.11")
    assert not nace_matches("C", "41.20")
    assert nace_matches("J62", "6201")
    assert nace_matches("43.21", "43.21")
    assert not nace_matches("43.21", "43.22")


def test_overpass_query_for_city_radius() -> None:
    area = ScopeArea(level="CITY", country="SE", name="Göteborg", latitude=57.7, longitude=11.97, radius_km=10)
    query = build_query(area, ['["craft"~"builder"]'], 50, 60)
    assert query is not None
    assert "(around:10000,57.7,11.97)" in query
    assert '["website"]' in query and "out center tags 50" in query


def test_overpass_record_parsing() -> None:
    element = {
        "type": "node",
        "id": 42,
        "lat": 57.7,
        "lon": 11.9,
        "tags": {"name": "Snickeri AB", "website": "snickeri.se", "craft": "carpenter", "addr:city": "Göteborg", "phone": "+46 31 00 00 00"},
    }
    record = to_record(element, "ODbL 1.0")
    assert record is not None
    assert record.source_record_id == "node/42"
    assert record.website == "https://snickeri.se"
    assert record.industry_label == "craft=carpenter"
    assert record.licence == "ODbL 1.0"
    assert to_record({"type": "node", "id": 1, "tags": {"name": "No site"}}, None) is None


def _run(policy: dict[str, object], source_type: str = "DATASET") -> DiscoveryRun:
    return DiscoveryRun(
        id="r", organization_id="o", project_id="p", source_id="s", attempt_count=1, max_attempts=3, query={},
        adapter="open_dataset", source_type=source_type, source_config={}, source_policy=policy, max_companies=10, settings={},
    )


def test_unapproved_sources_never_run() -> None:
    assert policy_refusal(_run({"policyStatus": "UNREVIEWED", "enabled": True, "permitted": True})) == "source_policy_unreviewed"
    assert policy_refusal(_run({"policyStatus": "APPROVED", "enabled": False, "permitted": True})) == "source_disabled"
    assert (
        policy_refusal(_run({"policyStatus": "APPROVED", "enabled": True, "permitted": True, "automatedAccessAllowed": False}))
        == "automated_access_not_confirmed"
    )
    assert policy_refusal(_run({"policyStatus": "APPROVED", "enabled": True, "permitted": True, "automatedAccessAllowed": True})) is None
    assert policy_refusal(_run({"policyStatus": "APPROVED", "enabled": True, "permitted": True}, "IMPORT")) is None
