import logging
from typing import Dict, Any, Optional
import httpx
from ..registry import ProviderRegistry
from ..base_client import BaseAPIClient
from src.config import settings

logger = logging.getLogger("klawhub.integrations.tavily")

@ProviderRegistry.register("tavily")
class TavilyClient(BaseAPIClient):
    """
    Tavily search API client for web search capabilities.
    """
    def __init__(self, workspace_id: Any, base_url: str = "https://api.tavily.com"):
        super().__init__(workspace_id=workspace_id, provider="tavily", base_url=base_url)
        # We don't always need an integration row for Tavily since it can be globally configured via env var
        self._global_api_key: Optional[str] = None
        self._init_global_key()

    def _init_global_key(self):
        """Initializes global key by trying to find a non-empty key from settings."""
        keys = [settings.tavily_api_key_1, settings.tavily_api_key_2, settings.tavily_api_key_3]
        for key in keys:
            if key:
                self._global_api_key = key
                break

        if not self._global_api_key:
             logger.warning("No global TAVILY_API_KEY found in settings. Search will fail if no workspace-specific integration is available.")

    async def _get_auth_headers(self) -> Dict[str, str]:
        """Override to inject the Tavily API key from the DB or fallback to global settings."""
        try:
             # This will fetch the integration and decrypt the access token if it exists
             await self.initialize()
             if self.access_token:
                 return {
                    "Content-Type": "application/json"
                 }
        except Exception:
             pass

        # If no DB integration is found, check if we have a global fallback
        if self._global_api_key:
            return {
                "Content-Type": "application/json"
            }

        raise ValueError("Tavily integration is not configured for this workspace, and no global API key is set.")

    async def _get_api_key(self) -> str:
        """Helper to get the API key to include in the payload."""
        try:
            await self.initialize()
            if self.access_token:
                return self.access_token
        except Exception:
            pass
        if self._global_api_key:
            return self._global_api_key
        raise ValueError("Tavily integration is not configured for this workspace, and no global API key is set.")

    async def search(self, query: str, search_depth: str = "advanced", max_results: int = 5) -> Dict[str, Any]:
        """
        Executes a web search query via Tavily.
        """
        headers = await self._get_auth_headers()
        api_key = await self._get_api_key()

        payload = {
            "api_key": api_key,
            "query": query,
            "search_depth": search_depth,
            "max_results": max_results,
            "include_answer": True,
            "include_raw_content": False
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/search",
                    json=payload,
                    headers=headers,
                    timeout=30.0
                )
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                logger.error(f"Tavily search failed for workspace {self.workspace_id}: {e}")
                raise

    async def refresh_access_token(self) -> str:
        """Tavily does not use OAuth tokens, so this is a no-op."""
        return ""
