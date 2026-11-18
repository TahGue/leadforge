"""User-provided company domains (spec section 10, source priority 1)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import tldextract

from .base import CompanyRecord, Scope, SourceAdapter, SourcePolicy

_extract = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None, include_psl_private_domains=True)


def registrable_domain(value: str) -> str | None:
    cleaned = value.strip().lower()
    for prefix in ("https://", "http://"):
        cleaned = cleaned.removeprefix(prefix)
    host = cleaned.split("/")[0].split("?")[0].split("#")[0].removeprefix("www.").rstrip(".")
    parts = _extract(host)
    if not parts.domain or not parts.suffix:
        return None
    return f"{parts.domain}.{parts.suffix}"


class DomainListAdapter(SourceAdapter):
    source_name = "domain_list"

    async def search(self, query: dict[str, Any], scope: Scope, filters: dict[str, Any], limit: int) -> AsyncIterator[CompanyRecord]:
        domains = list(query.get("domains") or self.config.get("domains") or [])
        seen: set[str] = set()
        for value in domains:
            domain = registrable_domain(str(value))
            if not domain or domain in seen:
                continue
            seen.add(domain)
            if len(seen) > limit:
                return
            # The company name is not known yet; the crawler records the site's stated name as evidence.
            yield CompanyRecord(
                source_record_id=domain,
                name=domain,
                website=f"https://{domain}/",
                raw={"input": str(value)},
                licence="operator-supplied",
            )

    async def get_policy(self) -> SourcePolicy:
        return SourcePolicy(
            source_type="IMPORT",
            terms_url=None,
            licence="operator-supplied",
            permitted_use="Domains supplied by the operator; only public pages are crawled, subject to robots.txt.",
            attribution=None,
            requests_per_minute=60,
            retention_days=None,
            automated_access=True,
            commercial_reuse=True,
        )
