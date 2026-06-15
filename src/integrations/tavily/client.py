from src.core.tools.web_search import search_tavily
from typing import Dict, Any

class TavilyClient:
    async def search(self, query: str, depth: str = "basic", max_results: int = 5) -> Dict[str, Any]:
        """Runs a Tavily web search."""
        return await search_tavily(query, depth, max_results)

# Global Tavily client instance
tavily_client = TavilyClient()
