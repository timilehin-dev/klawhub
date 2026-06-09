import asyncio
from src.integrations.providers.tavily import TavilyClient
from src.integrations.sandbox import SandboxClient

async def run_tests():
    print("Testing TavilyClient structure...")
    tavily = TavilyClient(workspace_id="test")
    assert tavily.provider == "tavily"
    print("TavilyClient structure passed.")

    print("Testing SandboxClient structure for Lightpanda...")
    sandbox = SandboxClient(function_url="http://localhost:8000", webhook_secret="secret")
    assert hasattr(sandbox, "read_web_page")
    print("SandboxClient Lightpanda structure passed.")

if __name__ == "__main__":
    asyncio.run(run_tests())

    print("Testing ResearchControl integration...")
    from src.core.tools.research_control import ResearchControl
    assert hasattr(ResearchControl, "web_search")
    assert hasattr(ResearchControl, "read_page")
    print("ResearchControl structures passed.")
