"""Source adapter registry (spec section 10)."""

from __future__ import annotations

from typing import Any

from .base import CompanyRecord, Scope, ScopeArea, SourceAdapter, SourcePolicy
from .domain_list import DomainListAdapter
from .open_dataset import OpenDatasetAdapter
from .osm_overpass import OverpassAdapter

ADAPTERS: dict[str, type[SourceAdapter]] = {
    DomainListAdapter.source_name: DomainListAdapter,
    OpenDatasetAdapter.source_name: OpenDatasetAdapter,
    OverpassAdapter.source_name: OverpassAdapter,
}


def get_adapter(name: str | None, config: dict[str, Any], policy: dict[str, Any]) -> SourceAdapter | None:
    cls = ADAPTERS.get(name or "")
    return cls(config, policy) if cls else None


__all__ = ["ADAPTERS", "CompanyRecord", "Scope", "ScopeArea", "SourceAdapter", "SourcePolicy", "get_adapter"]
