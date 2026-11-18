from leadforge.normalize import is_vendor_or_placeholder, normalize_email


def test_normalises_case_of_domain_only() -> None:
    result = normalize_email("Sales@Example.COM")
    assert result.normalized == "sales@example.com"
    assert result.domain == "example.com"
    assert result.valid is True


def test_strips_mailto_and_query() -> None:
    result = normalize_email("mailto:info@acme.se?subject=Hej")
    assert result.normalized == "info@acme.se"
    assert result.valid is True


def test_strips_surrounding_punctuation() -> None:
    result = normalize_email(" (hello@acme.io).")
    assert result.normalized == "hello@acme.io"


def test_rejects_invalid() -> None:
    assert normalize_email("not-an-email").valid is False
    assert normalize_email("two@@example.com").valid is False
    assert normalize_email("user@localhost").valid is False


def test_detects_role_accounts() -> None:
    assert normalize_email("info@acme.se").is_role_account is True
    assert normalize_email("sales+eu@acme.se").is_role_account is True
    assert normalize_email("anna.svensson@acme.se").is_role_account is False


def test_detects_free_and_disposable() -> None:
    assert normalize_email("someone@gmail.com").is_free_provider is True
    assert normalize_email("x@mailinator.com").is_disposable is True


def test_vendor_and_asset_filters() -> None:
    assert is_vendor_or_placeholder(normalize_email("logo@2x.png")) is True
    assert is_vendor_or_placeholder(normalize_email("abc@sentry.io")) is True
    assert is_vendor_or_placeholder(normalize_email("noreply@acme.se")) is True
    assert is_vendor_or_placeholder(normalize_email("info@example.com")) is True
    assert is_vendor_or_placeholder(normalize_email("anna@acme.se")) is False
