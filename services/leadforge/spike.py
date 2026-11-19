"""Phase 0 spike (spec Phase 0, docs/phase-0-spike.md): measure extraction yield on real sites.

    python -m leadforge.spike domains.txt --out reports/phase0

For each domain: robots.txt, the homepage, then up to N contact-like pages,
with the same SSRF guard, rate limit and policy stops as the crawler. Writes
``results.csv`` (one row per extracted value, for hand labelling) and
``summary.md`` (yield tables). Needs no database.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from .config import settings
from .extract import extract_page, page_kind
from .net import PolicyStop, fetch, make_client, registrable
from .robots import AsyncRobotsCache
from .safety import UnsafeUrlError
from .sources.domain_list import registrable_domain


@dataclass
class SiteResult:
    domain: str
    status: str = "ok"
    reason: str | None = None
    pages: int = 0
    emails: set[str] = field(default_factory=set)
    phones: set[str] = field(default_factory=set)
    forms: int = 0
    rows: list[dict[str, str]] = field(default_factory=list)
    seconds: float = 0.0


async def probe_site(client: object, robots: AsyncRobotsCache, domain: str, max_pages: int, delay: float) -> SiteResult:
    result = SiteResult(domain=domain)
    started = time.monotonic()
    queue = [f"https://{domain}/"]
    seen: set[str] = set()
    while queue and result.pages < max_pages:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        if not await robots.allowed(url):
            if not result.pages:
                result.status, result.reason = "blocked", "robots_disallow"
            continue
        if result.pages:
            await asyncio.sleep(delay)
        try:
            page = await fetch(client, url, allowed_registrable=registrable(domain))  # type: ignore[arg-type]
        except PolicyStop as stop:
            result.status, result.reason = "blocked", stop.reason
            break
        except UnsafeUrlError as error:
            result.status, result.reason = "unsafe", str(error)
            break
        except Exception as error:
            if not result.pages:
                result.status, result.reason = "error", type(error).__name__
            break
        result.pages += 1
        if page.status_code != 200 or not page.body:
            if result.pages == 1:
                result.status, result.reason = "error", page.skipped or f"http_{page.status_code}"
                break
            continue
        extraction = extract_page(page.body.decode("utf-8", errors="replace"), page.final_url)
        for candidate in extraction.candidates:
            if candidate.kind == "EMAIL":
                result.emails.add(candidate.normalized_value)
            elif candidate.kind == "PHONE":
                result.phones.add(candidate.normalized_value)
            else:
                result.forms += 1
            result.rows.append(
                {
                    "domain": domain,
                    "page_url": page.final_url,
                    "page_kind": page_kind(page.final_url),
                    "kind": candidate.kind,
                    "value": candidate.normalized_value,
                    "method": candidate.method,
                    "category": candidate.category or "",
                    "confidence": f"{candidate.confidence:.2f}",
                    "snippet": (candidate.snippet or "")[:200],
                    "label_correct": "",
                }
            )
        if result.pages == 1:
            queue.extend(extraction.contact_links[: max_pages - 1])
    result.seconds = time.monotonic() - started
    return result


def summary(results: list[SiteResult]) -> str:
    total = len(results)
    ok = [r for r in results if r.status == "ok"]
    with_email = [r for r in ok if r.emails]
    with_phone = [r for r in ok if r.phones]
    blocked = [r for r in results if r.status == "blocked"]
    lines = [
        "# Phase 0 spike — yield summary",
        "",
        f"Generated {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())} with user agent `{settings.crawler_user_agent}`.",
        "",
        "| Measure | Value |",
        "| --- | --- |",
        f"| Domains attempted | {total} |",
        f"| Crawled successfully | {len(ok)} |",
        f"| Blocked by policy (robots, 401/403/429, challenge) | {len(blocked)} |",
        f"| With at least one email | {len(with_email)} ({(len(with_email) / total * 100 if total else 0):.0f}%) |",
        f"| With at least one phone | {len(with_phone)} |",
        f"| With a contact form | {sum(1 for r in ok if r.forms)} |",
        f"| Emails found | {sum(len(r.emails) for r in ok)} |",
        f"| Pages fetched | {sum(r.pages for r in results)} |",
        "",
        "## Exit criteria (docs/phase-0-spike.md)",
        "",
        "- [ ] No enforcement block or complaint during the run",
        f"- [{'x' if len(with_email) >= 15 else ' '}] At least 15 companies with a usable business email (measured: {len(with_email)})",
        "- [ ] Hand-checked precision >= 85% on a 25-email sample (fill `label_correct` in results.csv, then run `python -m leadforge.evaluate --spike results.csv`)",
        "",
        "## Per site",
        "",
        "| Domain | Status | Pages | Emails | Phones | Forms | Reason |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    lines += [f"| {r.domain} | {r.status} | {r.pages} | {len(r.emails)} | {len(r.phones)} | {r.forms} | {r.reason or ''} |" for r in results]
    return "\n".join(lines) + "\n"


async def run(domains: list[str], max_pages: int, delay: float) -> list[SiteResult]:
    results: list[SiteResult] = []
    async with make_client() as client:
        robots = AsyncRobotsCache(client)
        for domain in domains:
            result = await probe_site(client, robots, domain, max_pages, delay)
            results.append(result)
            print(f"{domain}: {result.status} pages={result.pages} emails={len(result.emails)} {result.reason or ''}", flush=True)
            await asyncio.sleep(delay)
    return results


def write_reports(results: list[SiteResult], out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    with (out / "results.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["domain", "page_url", "page_kind", "kind", "value", "method", "category", "confidence", "snippet", "label_correct"]
        )
        writer.writeheader()
        for result in results:
            writer.writerows(result.rows)
    (out / "summary.md").write_text(summary(results), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 0 extraction-yield spike")
    parser.add_argument("domains", type=Path, help="text file, one domain per line (# comments allowed)")
    parser.add_argument("--out", type=Path, default=Path("reports/phase0"))
    parser.add_argument("--max-pages", type=int, default=4)
    parser.add_argument("--delay", type=float, default=max(3.0, settings.crawler_delay_ms / 1000))
    args = parser.parse_args()
    raw = [line.split("#")[0].strip() for line in args.domains.read_text(encoding="utf-8").splitlines()]
    domains = list(dict.fromkeys(d for d in (registrable_domain(x) for x in raw if x) if d))
    if not domains:
        print("no valid domains", file=sys.stderr)
        return 2
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    results = asyncio.run(run(domains, args.max_pages, args.delay))
    write_reports(results, args.out)
    print(f"wrote {args.out / 'results.csv'} and {args.out / 'summary.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
