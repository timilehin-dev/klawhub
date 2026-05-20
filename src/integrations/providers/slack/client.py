import logging
from typing import Dict, Any, List, Optional, TYPE_CHECKING
from sqlalchemy import select
from src.db.pool import get_db_session
from src.db.models import Workspace
from src.integrations.providers.base_client import BaseAPIClient
from src.integrations.providers.registry import ProviderRegistry
from src.integrations.crypto import decrypt_token

if TYPE_CHECKING:
    from slack_sdk.web.async_client import AsyncWebClient

logger = logging.getLogger("klawhub.integrations.providers.slack")

@ProviderRegistry.register("slack")
class SlackClient(BaseAPIClient):
    """Resilient Slack integration client. 
    
    Seamlessly combines our BaseAPIClient token security with Slack SDK's AsyncWebClient.
    Optimized to lazy-load heavy SDK components to keep Vercel boot times <100ms.
    """
    
    def __init__(self, workspace_id: Any):
        # Slack API base URL
        super().__init__(workspace_id, "slack", "https://slack.com/api")
        self.sdk_client: Optional[Any] = None

    async def _load_credentials(self) -> None:
        """Loads and decrypts credentials. Falls back to Workspace bot token if no user integration exists."""
        from slack_sdk.web.async_client import AsyncWebClient  # Lazy load to optimize Vercel cold starts
        
        try:
            # First try loading user-specific custom integration from 'integrations' table
            await super()._load_credentials()
            logger.info("Loaded custom user-scoped Slack credentials.")
        except Exception:
            # Fall back to workspace-wide bot_token from the 'workspaces' table
            logger.info("No user-scoped Slack integration found. Falling back to workspace bot token...")
            async with get_db_session() as session:
                statement = select(Workspace).where(Workspace.id == self.workspace_id)
                result = await session.execute(statement)
                workspace = result.scalar_one_or_none()
                
                if not workspace or not workspace.bot_token:
                    raise ValueError(f"No Slack credentials or bot token found for workspace: {self.workspace_id}")
                
                # Check prefix to avoid unnecessary decrypt attempts on plain text bot tokens
                if workspace.bot_token.startswith(("xoxb-", "xoxp-")):
                    self.access_token = workspace.bot_token
                else:
                    try:
                        self.access_token = decrypt_token(workspace.bot_token)
                    except Exception:
                        self.access_token = workspace.bot_token
                    
                self.refresh_token = None
                self.expires_at = None
                logger.info("Loaded workspace-wide Slack bot token.")
        
        # Initialize standard Slack SDK client using our decrypted token
        self.sdk_client = AsyncWebClient(token=self.access_token)

    async def refresh_access_token(self) -> Dict[str, Any]:
        """Slack bot tokens do not expire and don't support refresh flows. This is a secure no-op."""
        logger.info("Slack tokens do not support standard OAuth refresh cycles. No-op.")
        return {"access_token": self.access_token}

    async def get_sdk_client(self) -> "AsyncWebClient":
        """Retrieves a fully authorized instance of Slack's AsyncWebClient."""
        if not self.sdk_client:
            await self._load_credentials()
        return self.sdk_client

    # --- Resilient High-Level Wrappers ---

    async def post_message(
        self, 
        channel_id: str, 
        text: str, 
        blocks: Optional[List[Dict[str, Any]]] = None, 
        thread_ts: Optional[str] = None
    ) -> Dict[str, Any]:
        """Posts a message with rich block attachments to a specified channel or thread."""
        client = await self.get_sdk_client()
        response = await client.chat_postMessage(
            channel=channel_id,
            text=text,
            blocks=blocks,
            thread_ts=thread_ts
        )
        return response.data

    async def add_reaction(self, channel_id: str, timestamp: str, name: str) -> Dict[str, Any]:
        """Attaches an emoji reaction to a specific message in a channel."""
        client = await self.get_sdk_client()
        response = await client.reactions_add(
            channel=channel_id,
            timestamp=timestamp,
            name=name
        )
        return response.data

    async def remove_reaction(self, channel_id: str, timestamp: str, name: str) -> Dict[str, Any]:
        """Removes an emoji reaction from a specific message."""
        client = await self.get_sdk_client()
        response = await client.reactions_remove(
            channel=channel_id,
            timestamp=timestamp,
            name=name
        )
        return response.data

    async def get_history(self, channel_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Retrieves conversational messages history for a channel."""
        client = await self.get_sdk_client()
        response = await client.conversations_history(
            channel=channel_id,
            limit=limit
        )
        return response.data.get("messages", [])

    async def get_thread_replies(self, channel_id: str, thread_ts: str) -> List[Dict[str, Any]]:
        """Retrieves all replies to a specific thread."""
        client = await self.get_sdk_client()
        response = await client.conversations_replies(
            channel=channel_id,
            ts=thread_ts
        )
        return response.data.get("messages", [])

    async def upload_file(
        self, 
        channel_id: str, 
        content: str, 
        filename: str, 
        title: Optional[str] = None,
        thread_ts: Optional[str] = None
    ) -> Dict[str, Any]:
        """Uploads dynamic content or reports as a file to a channel/thread."""
        client = await self.get_sdk_client()
        # Using newer files_upload_v2 Slack method for resilience
        response = await client.files_upload_v2(
            channel=channel_id,
            content=content,
            filename=filename,
            title=title or filename,
            thread_ts=thread_ts
        )
        return response.data

    async def open_view(self, trigger_id: str, view: Dict[str, Any]) -> Dict[str, Any]:
        """Opens an interactive modal dialog in Slack using views.open."""
        client = await self.get_sdk_client()
        response = await client.views_open(
            trigger_id=trigger_id,
            view=view
        )
        return response.data

    async def update_view(self, view_id: str, view: Dict[str, Any], external_id: Optional[str] = None) -> Dict[str, Any]:
        """Updates an existing modal dialog in Slack using views.update."""
        client = await self.get_sdk_client()
        kwargs = {"view": view}
        if view_id:
            kwargs["view_id"] = view_id
        if external_id:
            kwargs["external_id"] = external_id
        response = await client.views_update(**kwargs)
        return response.data

