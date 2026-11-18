"""Source adapter contract (spec section 10).

Every adapter declares its policy and returns normalized ``CompanyRecord``s.
Adapters never decide what is in scope: they may pre-filter to save requests,
but the company_normalization stage applies the project's filters again.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, ClassVar

from pydantic import BaseModel, Field, field_validator


class IndustryCode(BaseModel):
    scheme: str = Field(pattern=r"^(NACE|SNI|ISIC|NAICS)$")
    code: str = Field(min_length=1, max_length=12)


class CompanyRecord(BaseModel):
    """One company as stated by a source. Absent facts stay None: never invented."""

    source_record_id: str = Field(min_length=1, max_length=300)
    name: str = Field(min_length=1, max_length=300)
    source_url: str | None = None
    website: str | None = None
    registration_number: str | None = Field(default=None, max_length=40)
    legal_form: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=5000)
    country: str | None = Field(default=None, min_length=2, max_length=2)
    region: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    phone: str | None = Field(default=None, max_length=40)
    industry_label: str | None = Field(default=None, max_length=200)
    industry_codes: list[IndustryCode] = Field(default_factory=list)
    employee_range: str | None = Field(default=None, max_length=40)
    founded_year: int | None = Field(default=None, ge=1600, le=2100)
    raw: dict[str, Any] = Field(default_factory=dict)
    licence: str | None = None

    @field_validator("country")
    @classmethod
    def upper(cls, value: str | None) -> str | None:
        return value.upper() if value else value

    @field_validator("website")
    @classmethod
    def website_scheme(cls, value: str | None) -> str | None:
        if not value:
            return None
        value = value.strip()
        if not value.startswith(("http://", "https://")):
            value = f"https://{value}"
        return value[:500]

    def row(self) -> dict[str, Any]:
        data = self.model_dump()
        data["industry_codes"] = [c.model_dump() for c in self.industry_codes]
        return data


@dataclass
class SourcePolicy:
    source_type: str
    terms_url: str | None
    licence: str | None
    permitted_use: str
    attribution: str | None
    requests_per_minute: int
    retention_days: int | None
    automated_access: bool
    commercial_reuse: bool


@dataclass
class ScopeArea:
    level: str  # COUNTRY | REGION | CITY | POINT | POSTAL | CONTINENT
    country: str | None = None
    name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    radius_km: float | None = None
    postal_prefix: str | None = None


@dataclass
class Scope:
    worldwide: bool
    areas: list[ScopeArea] = field(default_factory=list)
    countries: list[str] = field(default_factory=list)
    nace_codes: list[str] = field(default_factory=list)
    sector_codes: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)


class SourceAdapter(ABC):
    source_name: ClassVar[str]

    def __init__(self, config: dict[str, Any], policy: dict[str, Any]) -> None:
        self.config = config
        self.policy = policy

    @abstractmethod
    def search(self, query: dict[str, Any], scope: Scope, filters: dict[str, Any], limit: int) -> AsyncIterator[CompanyRecord]:
        """Yield normalized candidate company records."""

    @abstractmethod
    async def get_policy(self) -> SourcePolicy:
        """Return the configured policy and usage constraints."""
