from leadforge.extract import extract_page

CONTACT_HTML = """
<!doctype html>
<html>
  <head>
    <title>Acme AB | Contact</title>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Organization","email":"hello@acme.se"}
    </script>
    <script>var secret = "hidden@acme.se";</script>
    <style>.x { content: "style@acme.se"; }</style>
  </head>
  <body>
    <h1>Contact</h1>
    <p>Reach sales at <a href="mailto:sales@acme.se?subject=Hi">sales@acme.se</a>.</p>
    <p>Team: anna.svensson@acme.se</p>
    <p>Obfuscated: info (at) acme (dot) se</p>
    <p><img src="logo@2x.png" alt="logo" /></p>
    <div style="display:none">hidden@acme.se</div>
    <p>Vendor: widget@sentry.io</p>
    <p>Example: test@example.com</p>
    <a href="/about">About us</a>
    <a href="/impressum">Impressum</a>
  </body>
</html>
"""


def test_extracts_emails_with_methods() -> None:
    page = extract_page(CONTACT_HTML, "https://acme.se/contact")
    values = {candidate.normalized_value for candidate in page.emails}
    assert "sales@acme.se" in values
    assert "hello@acme.se" in values
    assert "anna.svensson@acme.se" in values
    assert "info@acme.se" in values


def test_ignores_script_style_hidden_and_vendor_addresses() -> None:
    page = extract_page(CONTACT_HTML, "https://acme.se/contact")
    values = {candidate.normalized_value for candidate in page.emails}
    assert "hidden@acme.se" not in values  # inside a script
    assert "style@acme.se" not in values
    assert "widget@sentry.io" not in values
    assert "test@example.com" not in values


def test_mailto_ranks_above_text() -> None:
    page = extract_page(CONTACT_HTML, "https://acme.se/contact")
    by_value = {candidate.normalized_value: candidate for candidate in page.emails}
    assert by_value["sales@acme.se"].method == "mailto"
    assert by_value["sales@acme.se"].confidence > by_value["anna.svensson@acme.se"].confidence


def test_finds_contact_links_and_company_name() -> None:
    page = extract_page(CONTACT_HTML, "https://acme.se/contact")
    assert page.company_name == "Acme AB"
    joined = " ".join(page.contact_links)
    assert "/about" in joined
    assert "/impressum" in joined


def test_does_not_extract_from_empty_body() -> None:
    page = extract_page("<html><body><p>No contact here.</p></body></html>", "https://acme.se/")
    assert page.emails == []
