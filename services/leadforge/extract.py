"""Deterministic extraction of company and contact evidence from one page (spec section 12).

Priority: mailto/tel links -> JSON-LD -> visible patterns -> forms -> metadata.
Nothing here guesses: a person's name or title is recorded only when the page
states it explicitly next to the contact detail (JSON-LD Person / contactPoint).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import phonenumbers
from selectolax.lexbor import LexborHTMLParser as HTMLParser

from .normalize import is_vendor_or_placeholder, normalize_email

EXTRACTOR_VERSION = "lf-extract-2.0"

EMAIL_IN_TEXT = re.compile(
    r"(?<![\w.+-])([a-z0-9](?:[a-z0-9._%+-]{0,62})@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?![\w.-])",
    re.IGNORECASE,
)

TITLE_SEPARATORS = re.compile("[|\\-\N{EN DASH}\N{EM DASH}:]")

PHONE_LABEL = re.compile(
    r"(?:tel(?:efon|ephone)?|phone|puh(?:elin)?|tlf|telefoon|växel|vaxel|call)\s*[.:]?\s*"
    r"(\+?[\d][\d\s().\-/]{6,20}\d)",
    re.IGNORECASE,
)

CONTACT_LINK_HINTS = (
    "contact", "kontakt", "contacto", "contatti", "yhteystiedot", "impressum", "imprint", "about",
    "om-oss", "om_oss", "omoss", "about-us", "uber-uns", "ueber-uns", "team", "medarbetare", "people",
    "ledning", "management", "leadership", "mentions-legales", "legal-notice", "support", "sales",
    "press", "media", "inkop", "procurement", "careers", "jobs", "karriar", "lediga-jobb",
)

PAGE_KINDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("CONTACT", ("contact", "kontakt", "contacto", "contatti", "yhteystiedot", "impressum", "imprint")),
    ("TEAM", ("team", "medarbetare", "people", "ledning", "management", "leadership", "staff")),
    ("ABOUT", ("about", "om-oss", "om_oss", "omoss", "uber-uns", "ueber-uns", "company", "foretaget")),
    ("PRESS", ("press", "media", "news")),
    ("SALES", ("sales", "forsaljning", "inkop", "procurement", "purchasing")),
    ("CAREERS", ("career", "jobs", "karriar", "lediga-jobb", "work-with-us", "jobba")),
)

METHOD_CONFIDENCE = {
    "mailto": 0.92,
    "tel": 0.88,
    "jsonld": 0.85,
    "form": 0.8,
    "contact-link": 0.75,
    "text": 0.6,
    "phone-text": 0.6,
}

CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("SALES", ("sales", "salj", "forsaljning", "order", "offert", "quote", "verkauf", "vertrieb", "myynti", "salg", "anbud")),
    ("PROCUREMENT", ("inkop", "purchasing", "procurement", "einkauf", "hankinta", "innkjop", "indkob", "supplier")),
    ("PRESS", ("press", "presse", "media", "medien", "news", "kommunikation", "viestinta", "pr")),
    ("SUPPORT", ("support", "help", "service", "kundtjanst", "kundservice", "kundenservice", "kundeservice", "customer", "asiakaspalvelu")),
    ("CAREERS", ("jobs", "job", "career", "careers", "karriere", "karriar", "rekrytering", "rekry", "recruiting", "recruit", "hr", "jobb", "work")),
    ("MANAGEMENT", ("ceo", "vd", "management", "ledning", "board", "styrelse", "director", "geschaeftsfuehrung", "geschaftsfuhrung", "toimitusjohtaja")),
    ("GENERAL", ("info", "contact", "kontakt", "hello", "hej", "hallo", "office", "mail", "post", "reception", "vaxel", "zentrale")),
)

TECH_SIGNATURES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("WordPress", ("wp-content/", "wp-includes/")),
    ("WooCommerce", ("woocommerce",)),
    ("Shopify", ("cdn.shopify.com", "shopify.theme")),
    ("Magento", ("mage/cookies", "magento")),
    ("Drupal", ("drupal-settings-json", "/sites/default/files/")),
    ("Joomla", ("/media/jui/", "joomla")),
    ("Wix", ("wixstatic.com", "x-wix")),
    ("Squarespace", ("static1.squarespace.com",)),
    ("Webflow", ("webflow.js", "data-wf-page")),
    ("Next.js", ("__next_data__", "/_next/static")),
    ("Nuxt", ("__nuxt", "/_nuxt/")),
    ("Angular", ("ng-version=",)),
    ("Vue", ("data-v-app", "vue.global")),
    ("React", ("data-reactroot", "react-dom")),
    ("HubSpot", ("js.hs-scripts.com", "hs-analytics")),
)
SHOP_HINTS = ("add-to-cart", "add_to_cart", "varukorg", "warenkorb", "checkout", "kassa", "basket")
BOOKING_HINTS = ("boka tid", "book now", "online booking", "bokning", "termin buchen")

SOCIAL_HOSTS = ("linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "xing.com")


@dataclass
class Candidate:
    kind: str  # EMAIL | PHONE | CONTACT_FORM
    raw_value: str
    normalized_value: str
    method: str
    selector: str | None = None
    snippet: str | None = None
    confidence: float = 0.5
    category: str | None = None
    person_name: str | None = None
    job_title: str | None = None


@dataclass
class PageExtraction:
    emails: list[Candidate] = field(default_factory=list)
    phones: list[Candidate] = field(default_factory=list)
    forms: list[Candidate] = field(default_factory=list)
    company_name: str | None = None
    description: str | None = None
    language: str | None = None
    technologies: list[str] = field(default_factory=list)
    social_profiles: list[str] = field(default_factory=list)
    contact_links: list[str] = field(default_factory=list)
    links: list[tuple[str, str]] = field(default_factory=list)  # (url, page kind)
    has_shop: bool = False
    has_booking: bool = False

    @property
    def candidates(self) -> list[Candidate]:
        return [*self.emails, *self.phones, *self.forms]


def page_kind(url: str) -> str:
    path = urlsplit(url).path.lower()
    if path in ("", "/"):
        return "HOME"
    for kind, hints in PAGE_KINDS:
        if any(hint in path for hint in hints):
            return kind
    return "OTHER"


def classify_contact(local_part: str | None, context: str | None) -> str:
    """Contact category from the address's local part, then its surrounding text."""
    tokens: list[str] = []
    if local_part:
        tokens.append(re.sub(r"[^a-z0-9]+", " ", local_part.lower()))
    if context:
        tokens.append(re.sub(r"[^a-z0-9åäöü]+", " ", context.lower()).replace("å", "a").replace("ä", "a").replace("ö", "o").replace("ü", "u"))
    joined = f" {' '.join(tokens)} "
    if local_part:
        local = re.sub(r"[^a-z0-9]+", " ", local_part.lower())
        for category, words in CATEGORY_RULES:
            if any(f" {w} " in f" {local} " for w in words):
                return category
        # first.last@ or f.last@ looks like a person; never infer who
        if re.fullmatch(r"[a-z]{1,20}[._-][a-z]{2,30}", local_part.lower()):
            return "NAMED"
    for category, words in CATEGORY_RULES:
        if any(f" {w} " in joined for w in words):
            return category
    return "OTHER" if local_part else "GENERAL"


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


def _add_email(
    found: dict[str, Candidate],
    raw: str,
    method: str,
    *,
    selector: str | None = None,
    snippet: str | None = None,
    category: str | None = None,
    person_name: str | None = None,
    job_title: str | None = None,
) -> None:
    normalized = normalize_email(raw)
    if not normalized.valid or is_vendor_or_placeholder(normalized):
        return
    existing = found.get(normalized.normalized)
    confidence = METHOD_CONFIDENCE.get(method, 0.5)
    if existing and existing.confidence >= confidence:
        if person_name and not existing.person_name:
            existing.person_name, existing.job_title = person_name, job_title
        return
    found[normalized.normalized] = Candidate(
        kind="EMAIL",
        raw_value=raw,
        normalized_value=normalized.normalized,
        method=method,
        selector=selector,
        snippet=(snippet or "")[:300] or None,
        confidence=confidence,
        category=category or classify_contact(normalized.local_part, snippet),
        person_name=person_name,
        job_title=job_title,
    )


def _add_phone(found: dict[str, Candidate], raw: str, method: str, region: str | None, *, snippet: str | None, category: str | None = None) -> None:
    try:
        number = phonenumbers.parse(raw, region or None)
    except phonenumbers.NumberParseException:
        return
    if not phonenumbers.is_valid_number(number):
        return
    e164 = phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)
    confidence = METHOD_CONFIDENCE.get(method, 0.5)
    existing = found.get(e164)
    if existing and existing.confidence >= confidence:
        return
    found[e164] = Candidate(
        kind="PHONE",
        raw_value=raw.strip()[:40],
        normalized_value=e164,
        method=method,
        snippet=(snippet or "")[:300] or None,
        confidence=confidence,
        category=category or classify_contact(None, snippet),
    )


def _text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()[:200]
    return None


def _jsonld(tree: HTMLParser, emails: dict[str, Candidate], phones: dict[str, Candidate], region: str | None) -> dict[str, str]:
    """Emails/phones from JSON-LD, with names/titles only from explicit Person objects."""
    facts: dict[str, str] = {}
    for node in tree.css('script[type="application/ld+json"]'):
        try:
            data = json.loads(node.text() or "")
        except json.JSONDecodeError:
            continue
        stack: list[object] = [data]
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(item)
                continue
            if not isinstance(item, dict):
                continue
            kind = item.get("@type")
            kinds = {str(k).lower() for k in (kind if isinstance(kind, list) else [kind])}
            person = "person" in kinds
            contact_type = _text(item.get("contactType"))
            category = classify_contact(None, contact_type) if contact_type else None
            name = _text(item.get("name")) if person else None
            title = _text(item.get("jobTitle")) if person else None
            email = item.get("email")
            if isinstance(email, str):
                _add_email(
                    emails,
                    email.replace("mailto:", ""),
                    "jsonld",
                    selector="json-ld",
                    snippet=f"{name or ''} {title or ''} {contact_type or ''}".strip() or None,
                    category="NAMED" if person and name else category,
                    person_name=name,
                    job_title=title,
                )
            telephone = item.get("telephone")
            if isinstance(telephone, str):
                _add_phone(phones, telephone, "jsonld", region, snippet=contact_type or name, category=category)
            if {"organization", "localbusiness", "corporation"} & kinds or any(k.endswith("business") for k in kinds):
                for key in ("legalName", "name", "description", "vatID", "taxID", "foundingDate"):
                    value = _text(item.get(key))
                    if value and key not in facts:
                        facts[key] = value
                address = item.get("address")
                if isinstance(address, dict):
                    for key in ("streetAddress", "postalCode", "addressLocality", "addressRegion", "addressCountry"):
                        value = _text(address.get(key))
                        if value:
                            facts.setdefault(key, value)
            for value in item.values():
                if isinstance(value, (dict, list)):
                    stack.append(value)
    return facts


def _company_name(tree: HTMLParser) -> str | None:
    meta = tree.css_first('meta[property="og:site_name"]')
    content = meta.attributes.get("content") if meta else None
    if content:
        return content.strip()[:200]
    title = tree.css_first("title")
    if title and title.text():
        return TITLE_SEPARATORS.split(title.text())[0].strip()[:200] or None
    return None


def _same_site(url: str, base_url: str) -> bool:
    a = (urlsplit(url).hostname or "").removeprefix("www.")
    b = (urlsplit(base_url).hostname or "").removeprefix("www.")
    return a == b


def _links(tree: HTMLParser, base_url: str) -> tuple[list[str], list[tuple[str, str]], list[str]]:
    contact: list[str] = []
    same_site: list[tuple[str, str]] = []
    social: list[str] = []
    seen: set[str] = set()
    for node in tree.css("a[href]"):
        href = (node.attributes.get("href") or "").strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:", "#", "data:")):
            continue
        absolute = urljoin(base_url, href).split("#")[0]
        if not absolute.startswith(("http://", "https://")):
            continue
        host = (urlsplit(absolute).hostname or "").lower()
        if any(host == s or host.endswith(f".{s}") for s in SOCIAL_HOSTS):
            if absolute not in social and len(social) < 10:
                social.append(absolute)
            continue
        if not _same_site(absolute, base_url) or absolute in seen:
            continue
        seen.add(absolute)
        kind = page_kind(absolute)
        same_site.append((absolute, kind))
        if any(hint in absolute.lower() for hint in CONTACT_LINK_HINTS) and len(contact) < 10:
            contact.append(absolute)
    return list(dict.fromkeys(contact)), same_site[:200], social


def _technologies(raw_html: str, tree: HTMLParser) -> list[str]:
    lowered = raw_html[:600_000].lower()
    found = [name for name, needles in TECH_SIGNATURES if any(n in lowered for n in needles)]
    generator = tree.css_first('meta[name="generator"]')
    content = (generator.attributes.get("content") or "") if generator else ""
    for name, _ in TECH_SIGNATURES:
        if name.lower() in content.lower() and name not in found:
            found.append(name)
    return found


def _forms(tree: HTMLParser, base_url: str) -> list[Candidate]:
    out: list[Candidate] = []
    for form in tree.css("form"):
        fields = " ".join(
            f"{(n.attributes.get('type') or '')} {(n.attributes.get('name') or '')}".lower()
            for n in form.css("input, textarea")
        )
        has_message = bool(form.css_first("textarea"))
        if has_message and ("email" in fields or "mail" in fields):
            action = form.attributes.get("action") or ""
            target = urljoin(base_url, action) if action and not action.startswith("javascript:") else base_url
            out.append(
                Candidate(
                    kind="CONTACT_FORM",
                    raw_value=base_url,
                    normalized_value=base_url.split("#")[0],
                    method="form",
                    selector="form",
                    snippet=f"form posts to {target}"[:300],
                    confidence=METHOD_CONFIDENCE["form"],
                    category="GENERAL",
                )
            )
            break
    return out


def extract_page(html: str, base_url: str, *, region: str | None = None) -> PageExtraction:
    raw_html = html
    tree = _clean_tree(html)
    emails: dict[str, Candidate] = {}
    phones: dict[str, Candidate] = {}

    for node in tree.css('a[href^="mailto:"]'):
        href = node.attributes.get("href") or ""
        address = href.split("?")[0]
        _add_email(emails, address, "mailto", selector="a[href^=mailto]", snippet=(node.parent.text() if node.parent else node.text()) or None)

    for node in tree.css('a[href^="tel:"]'):
        href = (node.attributes.get("href") or "")[4:]
        _add_phone(phones, href, "tel", region, snippet=(node.parent.text() if node.parent else node.text()) or None)

    facts = _jsonld(tree, emails, phones, region)

    body = tree.css_first("body") or tree.root
    text = body.text(separator=" ", strip=True) if body else ""
    text = re.sub(r"\s*[\[(]\s*at\s*[\])]\s*", "@", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*[\[(]\s*dot\s*[\])]\s*", ".", text, flags=re.IGNORECASE)
    scan = text[:400_000]
    for match in EMAIL_IN_TEXT.finditer(scan):
        start = max(0, match.start() - 60)
        _add_email(emails, match.group(1), "text", selector="body", snippet=scan[start : match.end() + 60])
    for match in PHONE_LABEL.finditer(scan):
        start = max(0, match.start() - 40)
        _add_phone(phones, match.group(1), "phone-text", region, snippet=scan[start : match.end() + 40])

    html_node = tree.css_first("html")
    lang = (html_node.attributes.get("lang") or "").strip().lower() if html_node else ""
    language = lang.split("-")[0][:8] if re.fullmatch(r"[a-z]{2,3}(-[a-z0-9]{2,8})*", lang) else None

    description_node = tree.css_first('meta[name="description"]') or tree.css_first('meta[property="og:description"]')
    description = (description_node.attributes.get("content") or "").strip()[:1000] if description_node else ""

    contact_links, links, social = _links(tree, base_url)
    lowered = raw_html[:600_000].lower()
    return PageExtraction(
        emails=sorted(emails.values(), key=lambda c: (-c.confidence, c.normalized_value)),
        phones=sorted(phones.values(), key=lambda c: (-c.confidence, c.normalized_value)),
        forms=_forms(tree, base_url),
        company_name=facts.get("legalName") or facts.get("name") or _company_name(tree),
        description=description or facts.get("description"),
        language=language,
        technologies=_technologies(raw_html, tree),
        social_profiles=social,
        contact_links=contact_links,
        links=links,
        has_shop=any(h in lowered for h in SHOP_HINTS),
        has_booking=any(h in lowered for h in BOOKING_HINTS),
    )
