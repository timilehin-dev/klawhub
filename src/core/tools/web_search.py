import httpx
from typing import List, Dict, Any, Optional
from src.config import settings

async def search_tavily(query: str, depth: str = "basic", max_results: int = 5) -> Dict[str, Any]:
    """Queries Tavily API for web search results."""
    url = "https://api.tavily.com/search"
    payload = {
        "api_key": settings.TAVILY_API_KEY,
        "query": query,
        "search_depth": depth,
        "max_results": max_results,
        "include_answer": True,
        "include_raw_content": False
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        return response.json()

async def search_web_tool(query: str, deep_research: bool = False) -> str:
    """Agent tool signature for web search. Returns a formatted summary of findings."""
    depth = "advanced" if deep_research else "basic"
    try:
        res = await search_tavily(query, depth=depth)
        answer = res.get("answer")
        results = res.get("results", [])
        
        output = []
        if answer:
            output.append(f"**Direct Answer Summary:**\n{answer}\n")
            
        output.append("**Search Results:**")
        for i, item in enumerate(results, 1):
            title = item.get("title", "No Title")
            url = item.get("url", "No URL")
            snippet = item.get("content", "No Snippet")
            output.append(f"{i}. [{title}]({url}): {snippet}")
            
        return "\n".join(output)
    except Exception as e:
        return f"Error executing web search: {str(e)}"
