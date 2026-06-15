from slack_sdk.web.async_client import AsyncWebClient
from src.db.operations import get_workspace_by_id
from src.core.security.encryptor import encryptor
from typing import Dict, Any, List, Optional

async def get_slack_client(workspace_id: str) -> AsyncWebClient:
    """Fetches workspace bot_token from DB, decrypts it, and returns a Slack AsyncWebClient."""
    workspace = await get_workspace_by_id(workspace_id)
    if not workspace:
        raise ValueError(f"Workspace {workspace_id} not found")
    
    encrypted_token = workspace.get("bot_token")
    if not encrypted_token:
        raise ValueError(f"Bot token missing for workspace {workspace_id}")
        
    decrypted_token = encryptor.decrypt(encrypted_token)
    return AsyncWebClient(token=decrypted_token)

async def post_slack_message(workspace_id: str, channel_id: str, text: str, thread_ts: Optional[str] = None, blocks: Optional[List[Dict[str, Any]]] = None) -> str:
    """Posts a message or Block Kit card to a Slack channel or thread."""
    client = await get_slack_client(workspace_id)
    
    payload = {
        "channel": channel_id,
        "text": text
    }
    if thread_ts:
        payload["thread_ts"] = thread_ts
    if blocks:
        payload["blocks"] = blocks
        
    resp = await client.chat_postMessage(**payload)
    if resp.get("ok"):
        return str(resp.get("ts"))
    raise RuntimeError(f"Slack postMessage failed: {resp.get('error')}")

async def update_slack_message(workspace_id: str, channel_id: str, ts: str, text: str, blocks: Optional[List[Dict[str, Any]]] = None) -> None:
    """Edits/updates an existing message (e.g. for streaming progress cards)."""
    client = await get_slack_client(workspace_id)
    
    payload = {
        "channel": channel_id,
        "ts": ts,
        "text": text
    }
    if blocks:
        payload["blocks"] = blocks
        
    await client.chat_update(**payload)

async def add_slack_reaction(workspace_id: str, channel_id: str, ts: str, emoji: str) -> None:
    """Appends an emoji reaction to a message."""
    client = await get_slack_client(workspace_id)
    await client.reactions_add(channel=channel_id, timestamp=ts, name=emoji)

async def fetch_thread_history(workspace_id: str, channel_id: str, thread_ts: str) -> List[Dict[str, Any]]:
    """Fetches all messages in a Slack thread for context assembly."""
    client = await get_slack_client(workspace_id)
    resp = await client.conversations_replies(channel=channel_id, ts=thread_ts)
    if resp.get("ok"):
        return resp.get("messages", [])
    return []
