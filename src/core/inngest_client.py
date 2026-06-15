"""
Shared Inngest client module.
Import `inngest_client` from here in all workflow files.
Having a single instance ensures all functions are bound to the same app
and correctly served by the FastAPI `serve()` call in api/inngest.py.
"""
import inngest
from src.config import settings

inngest_client = inngest.Inngest(
    app_id="klawhub",
    event_key=settings.INNGEST_EVENT_KEY,
    signing_key=settings.INNGEST_SIGNING_KEY or None,
    is_production=settings.ENVIRONMENT == "production",
)
