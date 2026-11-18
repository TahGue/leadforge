"""Deterministic email normalization and classification (no network access)."""

from __future__ import annotations

import re
from dataclasses import dataclass

EMAIL_RE = re.compile(
    r"^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
    r"@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$",
    re.IGNORECASE,
)

ROLE_PREFIXES = {
    "admin", "billing", "careers", "contact", "customerservice", "hello", "help", "hi",
    "hr", "info", "inquiries", "jobs", "legal", "mail", "marketing", "media", "noreply",
    "no-reply", "office", "press", "privacy", "recruiting", "sales", "security", "support",
    "team", "webmaster",
}

DISPOSABLE_DOMAINS = {
    "10minutemail.com", "guerrillamail.com", "mailinator.com", "tempmail.com",
    "throwawaymail.com", "yopmail.com", "trashmail.com", "sharklasers.com",
    "getnada.com", "dispostable.com",
}

FREE_PROVIDERS = {
    "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
    "yahoo.com", "ymail.com", "icloud.com", "me.com", "aol.com", "protonmail.com",
    "proton.me", "gmx.com", "gmx.de", "web.de", "mail.com", "yandex.com", "zoho.com",
}

# Addresses that are structurally suspicious or belong to tooling, not the company.
VENDOR_DOMAINS = {
    "sentry.io", "sentry-next.wixpress.com", "wixpress.com", "intercom-mail.com",
    "hubspotemail.net", "hubspot.com", "calendly.com", "shopify.com", "myshopify.com",
    "example.com", "example.org", "example.net", "domain.com", "yourdomain.com",
    "email.com", "test.com", "sentry.wixpress.com",
}

PLACEHOLDER_LOCALS = {"noreply", "no-reply", "donotreply", "do-not-reply", "postmaster"}

_ASSET_RE = re.compile(r"\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ttf|ico|pdf)$", re.IGNORECASE)


@dataclass(frozen=True)
class NormalizedEmail:
    address: str
    normalized: str
    local_part: str
    domain: str
    valid: bool
    is_role_account: bool
    is_disposable: bool
    is_free_provider: bool


def normalize_email(raw: str) -> NormalizedEmail:
    text = raw.strip()
    if text.lower().startswith("mailto:"):
        text = text[7:]
    text = text.split("?", 1)[0]
    text = text.strip("<>()[]\"' \t\r\n,;:.")
    # Unicode obfuscation commonly used in contact blocks.
    text = (
        text.replace(" [at] ", "@")
        .replace("[at]", "@")
        .replace(" (at) ", "@")
        .replace("(at)", "@")
        .replace(" [dot] ", ".")
        .replace("[dot]", ".")
    )

    if text.count("@") != 1:
        return NormalizedEmail(text, text.lower(), "", "", False, False, False, False)

    local, domain = text.rsplit("@", 1)
    domain = domain.lower().rstrip(".")
    valid = bool(EMAIL_RE.match(f"{local}@{domain}")) and len(domain) <= 253
    base_local = local.lower().split("+", 1)[0]

    return NormalizedEmail(
        address=f"{local}@{domain}",
        normalized=f"{local.lower()}@{domain}",
        local_part=local,
        domain=domain,
        valid=valid,
        is_role_account=base_local in ROLE_PREFIXES,
        is_disposable=domain in DISPOSABLE_DOMAINS,
        is_free_provider=domain in FREE_PROVIDERS,
    )


def is_vendor_or_placeholder(normalized: NormalizedEmail) -> bool:
    if not normalized.valid:
        return True
    if normalized.domain in VENDOR_DOMAINS:
        return True
    if normalized.local_part.lower() in PLACEHOLDER_LOCALS:
        return True
    if _ASSET_RE.search(normalized.address):
        return True
    # "logo@2x.png" style captures parse as a domain with a file extension.
    return normalized.domain.split(".")[-1].lower() in {
        "png", "jpg", "jpeg", "gif", "svg", "webp", "css", "js",
    }
