import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import Optional

class Settings(BaseSettings):
    # === LLM ===
    OLLAMA_API_KEY: Optional[str] = None
    OLLAMA_BASE_URL: str = "https://ollama.com/v1"
    NEMOTRON_MODEL: str = "nemotron-3-ultra:cloud"

    # === Supabase ===
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_ANON_KEY: str = ""
    DATABASE_URL: str = ""
    DIRECT_DATABASE_URL: Optional[str] = None

    # === Upstash Redis ===
    UPSTASH_REDIS_REST_URL: str = ""
    UPSTASH_REDIS_REST_TOKEN: str = ""
    UPSTASH_REDIS_URL: str = ""

    # === Slack ===
    SLACK_BOT_TOKEN: str = ""
    SLACK_SIGNING_SECRET: str = ""
    SLACK_APP_TOKEN: Optional[str] = None
    SLACK_CLIENT_ID: Optional[str] = None
    SLACK_CLIENT_SECRET: Optional[str] = None

    # === Inngest ===
    INNGEST_EVENT_KEY: str = ""
    INNGEST_SIGNING_KEY: Optional[str] = None
    INNGEST_BASE_URL: Optional[str] = None

    # === Modal ===
    MODAL_TOKEN_ID: str = ""
    MODAL_TOKEN_SECRET: str = ""

    # === Tavily ===
    TAVILY_API_KEY: str = ""

    # === Google OAuth ===
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None

    # === GitHub App ===
    GITHUB_APP_ID: Optional[str] = None
    GITHUB_APP_PRIVATE_KEY: Optional[str] = None
    GITHUB_APP_CLIENT_ID: Optional[str] = None
    GITHUB_APP_CLIENT_SECRET: Optional[str] = None

    # === Security ===
    ENCRYPTION_KEY: str = ""  # 32-byte AES key hex
    HMAC_SECRET: str = ""     # HMAC signing secret

    # === App ===
    NEXT_PUBLIC_APP_URL: str = ""
    ENVIRONMENT: str = "production"
    LOG_LEVEL: str = "info"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_file_ignore_missing=True
    )

# Global settings instance
settings = Settings()
