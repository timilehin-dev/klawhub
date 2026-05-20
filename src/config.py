import os
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, AliasChoices

class Settings(BaseSettings):
    # Base Application Config
    env: str = Field(default="production", validation_alias="NODE_ENV")
    
    # Supabase / Postgres Database
    database_url: str = Field(..., validation_alias="DATABASE_URL")
    
    # Redis Cache & Checkpointer State
    upstash_redis_rest_url: str = Field(..., validation_alias="UPSTASH_REDIS_REST_URL")
    upstash_redis_rest_token: str = Field(..., validation_alias="UPSTASH_REDIS_REST_TOKEN")
    state_signing_key: str = Field(
        default="klawhub_default_secret_signing_key_change_me", 
        validation_alias=AliasChoices("STATE_SIGNING_KEY", "SLACK_SIGNING_SECRET")
    )
    
    # Slack OAuth & Credentials
    slack_signing_secret: str = Field(..., validation_alias="SLACK_SIGNING_SECRET")
    slack_bot_token: str = Field(..., validation_alias="SLACK_BOT_TOKEN")
    
    # Modal sandbox webhook client
    modal_function_url: str = Field(..., validation_alias="MODAL_FUNCTION_URL")
    modal_webhook_secret: str = Field(..., validation_alias="MODAL_WEBHOOK_SECRET")
    
    # Resend Email API Key
    resend_api_key: Optional[str] = Field(default=None, validation_alias="RESEND_API_KEY")
    
    # Encryption key for integration credentials storage
    integration_encryption_key: str = Field(..., validation_alias="INTEGRATION_ENCRYPTION_KEY")
    
    # Rotating Tavily Search Keys (with fallbacks to standard TAVILY_API_KEY)
    tavily_api_key_1: Optional[str] = Field(
        default=None, 
        validation_alias=AliasChoices("TAVILY_API_KEY_1", "TAVILY_API_KEY")
    )
    tavily_api_key_2: Optional[str] = Field(default=None, validation_alias="TAVILY_API_KEY_2")
    tavily_api_key_3: Optional[str] = Field(default=None, validation_alias="TAVILY_API_KEY_3")
    
    # Rotating Ollama Keys (with fallbacks to standard OLLAMA_API_KEY)
    ollama_api_key_1: Optional[str] = Field(
        default=None, 
        validation_alias=AliasChoices("OLLAMA_API_KEY_1", "OLLAMA_API_KEY")
    )
    ollama_api_key_2: Optional[str] = Field(default=None, validation_alias="OLLAMA_API_KEY_2")
    ollama_api_key_3: Optional[str] = Field(default=None, validation_alias="OLLAMA_API_KEY_3")
    ollama_base_url: str = Field(
        default="https://api.ollama.com/v1", 
        validation_alias="OLLAMA_BASE_URL"
    )
    
    # Model config to parse .env.local file if present
    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def tavily_keys(self) -> List[str]:
        """Returns non-empty Tavily keys as a rotating list."""
        keys = [self.tavily_api_key_1, self.tavily_api_key_2, self.tavily_api_key_3]
        return [k for k in keys if k]

    @property
    def ollama_keys(self) -> List[str]:
        """Returns non-empty Ollama keys as a rotating list."""
        keys = [self.ollama_api_key_1, self.ollama_api_key_2, self.ollama_api_key_3]
        return [k for k in keys if k]

# Initialize Settings singleton
settings = Settings()
