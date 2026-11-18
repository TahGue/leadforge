from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql://leadforge:leadforge_local@127.0.0.1:5432/leadforge"
    redis_url: str = "redis://127.0.0.1:6379/0"

    crawler_user_agent: str = "LeadForgeBot/0.1 (+https://localhost/bot)"
    crawler_max_concurrent_domains: int = 10
    crawler_delay_ms: int = 2000
    crawler_max_pages_per_company: int = 10
    crawler_respect_robots: bool = True
    crawler_timeout_seconds: float = 20.0
    crawler_max_bytes: int = 2_000_000
    crawler_max_redirects: int = 10

    artifact_dir: str = "data/artifacts"
    ollama_url: str = "http://127.0.0.1:11434"


settings = Settings()
