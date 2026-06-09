import logging
import uuid
from typing import Dict, Any, Optional
from src.integrations.providers.tavily import TavilyClient
from src.integrations.sandbox import sandbox_client

logger = logging.getLogger("klawhub.core.tools.research_control")

class ResearchControl:
    """Provides Web Search and Web Page Reading capabilities for the agent."""

    @classmethod
    async def web_search(
        cls,
        workspace_id: uuid.UUID,
        query: str,
        search_depth: str = "advanced",
        max_results: int = 5
    ) -> Dict[str, Any]:
        """Performs a web search using Tavily."""
        try:
            client = TavilyClient(workspace_id=workspace_id)
            result = await client.search(query=query, search_depth=search_depth, max_results=max_results)
            return {"status": "success", "data": result}
        except Exception as e:
            logger.error(f"Web search failed: {e}")
            return {"status": "error", "message": str(e)}

    @classmethod
    async def read_page(
        cls,
        workspace_id: uuid.UUID,
        url: str,
        engine: str = "lightpanda",
        timeout_seconds: int = 30
    ) -> Dict[str, Any]:
        """Reads the content of a web page using Lightpanda inside the Modal Sandbox."""
        try:
            # We don't strictly need workspace_id for the current Modal implementation,
            # but we pass it for consistent signature/future multi-tenant billing
            result = await sandbox_client.read_web_page(url=url, engine=engine, timeout_seconds=timeout_seconds)
            return {"status": "success", "data": result}
        except Exception as e:
            logger.error(f"Read page failed: {e}")
            return {"status": "error", "message": str(e)}
