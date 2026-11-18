"""Deterministic extraction of emails and company hints from a page."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from .normalize import is_vendor_or_placeholder, normalize_email

EMAIL_IN_TEXT = re.compile(
    r"(?<![\w.+-])([a-z0-9](?:[a-z0-9._%+-]{0,62})@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?![\w.-])",
    re.IGNORECASE,
)

CONTACT_LINK_HINTS = (
    "contact", "kontakt", "contacto", "contatti", "impressum", "imprint", "about",
    "team", "mentions-legales", "legal-notice", "support", "sales",
)

METHOD_CONFIDENCE = {
    "mailto": 0.92,
    "jsonld": 0.85,
    "contact-link": 0.75,
    "text": 0.6,
}


@dataclass
class Candidate:
    kind: str
    raw_value: str
    normalized_value: str
    method: str
    selector: str | None = None
    snippet: str | None = None
    confidence: float = 0.5


@dataclass
class PageExtraction:
    emails: list[Candidate] = field(default_factory=list)
    company_name: str | None = None
    contact_links: list[str] = field(default_factory=list)


def _clean_tree(html: str) -> HTMLParser:
    tree = HTMLParser(html)
    for node in tree.css("script"):
        # JSON-LD is data, not executable code: keep it for the structured pass.
        if "ld+json" in (node.attributes.get("type") or "").lower():
            continue
        node.decompose()
    for selector in ("style", "noscript", "template", "svg"):
        for node in tree.css(selector):
            node.decompose()
    for node in tree.css("[hidden]"):
        node.decompose()
    for node in tree.css("[style]"):
        style = (node.attributes.get("style") or "").replace(" ", "").lower()
        if "display:none" in style or "visibility:hidden" in style:
            node.decompose()
    return tree


def _add(
    found: dict[str, Candidate],
    raw: str,
    method: str,
    *,
    selector: str | None = None,
    snippet: str | None = None,
) -> None:
    normalized = normalize_email(raw)
    if not normalized.valid or is_vendor_or_placeholder(normalized):
        return
    existing = found.get(normalized.normalized)
    confidence = METHOD_CONFIDENCE.get(method, 0.5)
    if existing and existing.confidence >= confidence:
        return
    found[normalized.normalized] = Candidate(
        kind="EMAIL",
        raw_value=raw,
        normalized_value=normalized.normalized,
        method=method,
        selector=selector,
        snippet=(snippet or "")[:300] or None,
        confidence=confidence,
    )


def _jsonld_emails(tree: HTMLParser, found: dict[str, Candidate]) -> None:
    for node in tree.css('script[type="application/ld+json"]'):
        payload = node.text() or ""
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue

        stack = [data]
        while stack:
            item = stack.pop()
            if isinstance(item, dict):
                for key, value in item.items():
                    if key.lower() == "email" and isinstance(value, str):
                        _add(found, value.replace("mailto:", ""), "jsonld", selector="json-ld")
                    elif isinstance(value, (dict, list)):
                        stack.append(value)
            elif isinstance(item, list):
                stack.extend(item)


def _company_name(tree: HTMLParser) -> str | None:
    meta = tree.css_first('meta[property="og:site_name"]')
    content = meta.attributes.get("content") if meta else None
    if content:
        return content.strip()[:200]
    title = tree.css_first("title")
    if title and title.text():
        return re.split(r"[|\-\u2013\u2014:]", title.text())[0].strip()[:200] or None
    return None


def _contact_links(tree: HTMLParser, base_url: str) -> list[str]:
    links: list[str] = []
    for node in tree.css("a[href]"):
        href = node.attributes.get("href") or ""
        if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        absolute = urljoin(base_url, href)
        lowered = absolute.lower()
        if any(hint in lowered for hint in CONTACT_LINK_HINTS) and len(links) < 10:
            links.append(absolute.split("#")[0])
    return list(dict.fromkeys(links))


def extract_page(html: str, base_url: str) -> PageExtraction:
    tree = _clean_tree(html)
    found: dict[str, Candidate] = {}

    for node in tree.css('a[href^="mailto:"]'):
        href = node.attributes.get("href") or ""
        _add(found, href, "mailto", selector="a[href^=mailto]", snippet=node.text() or None)

    _jsonld_emails(tree, found)

    body = tree.css_first("body") or tree.root
    text = body.text(separator=" ", strip=True) if body else ""
    # Normalise common obfuscation before scanning plain text.
    text = re.sub(r"\s*[\[(]\s*at\s*[\])]\s*", "@", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*[\[(]\s*dot\s*[\])]\s*", ".", text, flags=re.IGNORECASE)
    for match in EMAIL_IN_TEXT.finditer(text[:400_000]):
        start = max(0, match.start() - 60)
        _add(
            found,
            match.group(1),
            "text",
            selector="body",
            snippet=text[start : match.end() + 60],
        )

    return PageExtraction(
        emails=sorted(found.values(), key=lambda c: (-c.confidence, c.normalized_value)),
        company_name=_company_name(tree),
        contact_links=_contact_links(tree, base_url),
    )
