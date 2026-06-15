"""
KlawHub Inngest Webhook Service.

Serves all Inngest workflow functions via FastAPI.
Uses the shared inngest_client — critical for all triggers to be routed correctly.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI

try:
    from inngest.fast_api import serve
except ImportError:
    from inngest.fastapi import serve

from src.core.inngest_client import inngest_client
from src.db.client import init_db_pool, close_db_pool
from src.workflows.message_handler import (
    handle_slack_message_event,
    handle_slack_slash_command,
)
from src.workflows.proactive_loop import proactive_schedule_loop
from src.workflows.skill_installer import install_skill_from_github
from src.workflows.workflow_executor import execute_workflow
from src.workflows.workspace_installer import handle_workspace_install
from src.workflows.integration_handler import handle_integration_authenticated


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and teardown the asyncpg connection pool."""
    await init_db_pool()
    yield
    await close_db_pool()


app = FastAPI(
    title="KlawHub Inngest Webhook Service",
    version="2.0.0",
    lifespan=lifespan,
)

# Register all Inngest functions with the shared client
serve(
    app,
    inngest_client,
    [
        handle_slack_message_event,
        handle_slack_slash_command,
        proactive_schedule_loop,
        install_skill_from_github,
        execute_workflow,
        handle_workspace_install,   # ← OAuth workspace registration
        handle_integration_authenticated,  # ← Google/GitHub token storage
    ],
)
