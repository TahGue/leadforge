from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql://leadforge:leadforge_local@127.0.0.1:5432/leadforge"
    redis_url: str = "redis://127.0.0.1:6379/0"

    # A truthful, contactable user agent is required before crawling (spec 24).
    crawler_user_agent: str = "LeadForgeBot/0.2 (+https://localhost/bot)"
    crawler_global_concurrency: int = 4
    crawler_per_domain_concurrency: int = 1
    crawler_delay_ms: int = 3000
    crawler_max_pages_per_company: int = 12
    crawler_max_depth: int = 2
    crawler_max_response_mb: float = 8.0
    crawler_respect_robots: bool = True
    crawler_timeout_seconds: float = 20.0
    crawler_max_redirects: int = 5
    crawler_playwright_enabled: bool = False
    # Contacts at or above this confidence, on the company's own domain and
    # found by a deterministic method, are promoted without manual review.
    crawler_auto_promote_confidence: float = 0.85

    discovery_poll_seconds: float = 5.0
    discovery_max_records: int = 5000

    artifact_dir: str = "data/artifacts"
    artifact_retention_days: int = 90
    imports_dir: str = "data/imports"

    ollama_url: str = "http://127.0.0.1:11434"
    ollama_enabled: bool = False
    ollama_classification_model: str = "qwen3.8:27b"  # ADR-0025
    ollama_timeout_seconds: float = 180.0  # first call loads the model
    ollama_batch: int = 10

    # Trained triage classifier (ADR-0026): learns from the LLM's and reviewers' labels,
    # decides the clear cases in milliseconds and leaves the rest to the LLM.
    triage_enabled: bool = True
    triage_min_examples: int = 100  # labelled companies an organization needs before a model is trained
    triage_min_per_class: int = 10  # industries with fewer examples are left to the LLM
    triage_accept_probability: float = 0.85
    triage_retrain_seconds: float = 600.0
    triage_batch: int = 2000

    @property
    def crawler_max_bytes(self) -> int:
        return int(self.crawler_max_response_mb * 1024 * 1024)


settings = Settings()
