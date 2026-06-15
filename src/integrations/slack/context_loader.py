from typing import List, Dict, Any
from src.core.tools.slack_tools import fetch_thread_history
from src.core.llm.client import llm_client

async def load_thread_context(workspace_id: str, channel_id: str, thread_ts: str, max_context_tokens: int = 120000) -> List[Dict[str, str]]:
    """Loads all messages in a Slack thread and trims them using a sliding window to fit context limits."""
    raw_messages = await fetch_thread_history(workspace_id, channel_id, thread_ts)
    if not raw_messages:
        return []

    formatted_messages = []
    
    # Format each message
    for msg in raw_messages:
        role = "assistant" if msg.get("bot_id") or msg.get("app_id") else "user"
        user_name = msg.get("username") or msg.get("user") or "User"
        text = msg.get("text", "")
        
        # Format the content
        content = f"[{user_name}]: {text}" if role == "user" else text
        formatted_messages.append({"role": role, "content": content})

    # Apply sliding window trimming if context size exceeded
    while True:
        total_text = "".join([m["content"] for m in formatted_messages])
        estimated_tokens = llm_client.estimate_tokens(total_text)
        
        if estimated_tokens <= max_context_tokens or len(formatted_messages) <= 2:
            break
            
        # Remove the oldest message that is NOT the first root message (preserve original query/context if possible)
        if len(formatted_messages) > 2:
            formatted_messages.pop(1)
        else:
            formatted_messages.pop(0)

    # Let's prepend a system persona prompt to direct the agent
    system_prompt = {
        "role": "system",
        "content": (
            "You are KlawHub, a self-evolving, Slack-first AI coworker. "
            "You handle complex tasks autonomously. Use tools where necessary. "
            "Respond naturally and professionally. Follow formatting instructions. "
            "Verify all your outputs factually and check for sensitive leaks."
        )
    }
    
    return [system_prompt] + formatted_messages
