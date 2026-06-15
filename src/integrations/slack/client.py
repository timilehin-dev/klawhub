from src.core.tools.slack_tools import get_slack_client
from slack_sdk.web.async_client import AsyncWebClient

class SlackClient:
    async def get_client(self, workspace_id: str) -> AsyncWebClient:
        """Retrieves active Slack AsyncWebClient for workspace."""
        return await get_slack_client(workspace_id)

# Global client instance
slack_client = SlackClient()
