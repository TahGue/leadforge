"""Phones, categories, forms, explicit names, language and technology detection."""

from __future__ import annotations

from leadforge.crawler import should_auto_promote
from leadforge.extract import Candidate, classify_contact, extract_page, page_kind

PAGE = """
<!doctype html><html lang="sv-SE"><head>
<title>Bygg &amp; Montage AB &ndash; Kontakt</title>
<meta name="description" content="Byggföretag i Göteborg sedan 1987.">
<meta name="generator" content="WordPress 6.6">
<link rel="stylesheet" href="/wp-content/themes/x/style.css">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"LocalBusiness","name":"Bygg & Montage AB","telephone":"+46 31 123 45 67",
 "address":{"@type":"PostalAddress","addressLocality":"Göteborg","postalCode":"411 01"},
 "employee":[{"@type":"Person","name":"Anna Berg","jobTitle":"VD","email":"anna.berg@byggmontage.se"}],
 "contactPoint":{"@type":"ContactPoint","contactType":"sales","email":"offert@byggmontage.se"}}
</script>
</head><body>
<p>Växel: <a href="tel:+46317654321">031-765 43 21</a></p>
<p>Försäljning: <a href="mailto:sales@byggmontage.se">sales@byggmontage.se</a></p>
<p>Lediga jobb: jobb@byggmontage.se</p>
<p>Telefon: 031 111 22 33</p>
<form action="/send"><input type="email" name="email"><textarea name="message"></textarea></form>
<a href="/om-oss">Om oss</a> <a href="/kontakt">Kontakt</a> <a href="https://www.linkedin.com/company/bygg">LinkedIn</a>
<a href="https://other.example/">Partner</a>
</body></html>
"""


def page() -> object:
    return extract_page(PAGE, "https://byggmontage.se/kontakt", region="SE")


def test_extracts_phones_in_e164() -> None:
    result = extract_page(PAGE, "https://byggmontage.se/kontakt", region="SE")
    numbers = {p.normalized_value: p for p in result.phones}
    assert "+46317654321" in numbers and numbers["+46317654321"].method == "tel"
    assert "+46311234567" in numbers and numbers["+46311234567"].method == "jsonld"
    assert "+46311112233" in numbers and numbers["+46311112233"].method == "phone-text"


def test_categories_from_local_part_and_context() -> None:
    result = extract_page(PAGE, "https://byggmontage.se/kontakt", region="SE")
    by_email = {e.normalized_value: e for e in result.emails}
    assert by_email["sales@byggmontage.se"].category == "SALES"
    assert by_email["jobb@byggmontage.se"].category == "CAREERS"
    assert by_email["offert@byggmontage.se"].category == "SALES"


def test_names_and_titles_only_when_explicit() -> None:
    result = extract_page(PAGE, "https://byggmontage.se/kontakt", region="SE")
    by_email = {e.normalized_value: e for e in result.emails}
    anna = by_email["anna.berg@byggmontage.se"]
    assert anna.person_name == "Anna Berg"
    assert anna.job_title == "VD"
    assert anna.category == "NAMED"
    assert by_email["sales@byggmontage.se"].person_name is None


def test_contact_form_language_technology_and_links() -> None:
    result = extract_page(PAGE, "https://byggmontage.se/kontakt", region="SE")
    assert [f.kind for f in result.forms] == ["CONTACT_FORM"]
    assert result.language == "sv"
    assert "WordPress" in result.technologies
    assert result.description and "Göteborg" in result.description
    assert any("linkedin.com" in s for s in result.social_profiles)
    kinds = dict(result.links)
    assert kinds["https://byggmontage.se/om-oss"] == "ABOUT"
    assert all("other.example" not in url for url, _ in result.links)
    assert result.company_name == "Bygg & Montage AB"


def test_page_kind() -> None:
    assert page_kind("https://a.se/") == "HOME"
    assert page_kind("https://a.se/kontakt") == "CONTACT"
    assert page_kind("https://a.se/about-us") == "ABOUT"
    assert page_kind("https://a.se/karriar/lediga-jobb") == "CAREERS"


def test_classify_contact() -> None:
    assert classify_contact("info", None) == "GENERAL"
    assert classify_contact("press", None) == "PRESS"
    assert classify_contact("anna.berg", None) == "NAMED"
    assert classify_contact(None, "Kundtjänst") == "SUPPORT"


def test_auto_promotion_rules() -> None:
    role = Candidate(kind="EMAIL", raw_value="sales@acme.se", normalized_value="sales@acme.se", method="mailto", confidence=0.92, category="SALES")
    assert should_auto_promote(role, "acme.se", 0.85) == (True, None)
    off_domain = Candidate(kind="EMAIL", raw_value="sales@other.se", normalized_value="sales@other.se", method="mailto", confidence=0.92)
    assert should_auto_promote(off_domain, "acme.se", 0.85)[0] is False
    text = Candidate(kind="EMAIL", raw_value="info@acme.se", normalized_value="info@acme.se", method="text", confidence=0.6)
    assert should_auto_promote(text, "acme.se", 0.85)[0] is False
    person = Candidate(kind="EMAIL", raw_value="anna.berg@acme.se", normalized_value="anna.berg@acme.se", method="jsonld", confidence=0.85, category="NAMED")
    assert should_auto_promote(person, "acme.se", 0.85)[0] is False
    free = Candidate(kind="EMAIL", raw_value="info@gmail.com", normalized_value="info@gmail.com", method="mailto", confidence=0.92)
    assert should_auto_promote(free, "acme.se", 0.85)[0] is False
    phone = Candidate(kind="PHONE", raw_value="+46 31", normalized_value="+46311234567", method="tel", confidence=0.88)
    assert should_auto_promote(phone, "acme.se", 0.85) == (True, None)
