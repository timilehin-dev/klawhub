from typing import List, Dict, Any, Optional
from src.core.tools.skill_runner import run_sandbox_function
from src.db.operations import add_memory, search_memory, add_knowledge, search_knowledge

async def get_embedding(text: str) -> List[float]:
    """Helper to get text embedding vector from Modal sandbox (keeps Vercel worker extremely lightweight)."""
    embeddings = await run_sandbox_function("embed_texts", [text])
    return embeddings[0]

async def remember_observation(workspace_id: str, content: str, slack_user_id: Optional[str] = None, memory_type: str = "observation", source_ts: Optional[str] = None, source_channel: Optional[str] = None) -> str:
    """Agent tool to save an observation, preference, or fact to the workspace memory."""
    try:
        embedding = await get_embedding(content)
        await add_memory(
            workspace_id=workspace_id,
            slack_user_id=slack_user_id,
            content=content,
            embedding=embedding,
            memory_type=memory_type,
            source_ts=source_ts,
            source_channel=source_channel
        )
        return "Observation saved to memory."
    except Exception as e:
        return f"Failed to save observation: {str(e)}"

async def query_memory_tool(workspace_id: str, query: str, limit: int = 5) -> str:
    """Agent tool to perform hybrid similarity search across workspace memories."""
    try:
        embedding = await get_embedding(query)
        matches = await search_memory(workspace_id, embedding, limit=limit)
        if not matches:
            return "No matching memories found."
            
        output = ["**Matching Memories:**"]
        for m in matches:
            score = round(m['similarity'] * 100, 1)
            output.append(f"- [{score}% similarity] {m['content']} (Type: {m['memory_type']})")
        return "\n".join(output)
    except Exception as e:
        return f"Memory search error: {str(e)}"

async def add_knowledge_item(workspace_id: str, title: str, content: str, source_url: Optional[str] = None, source_type: str = "document", tags: Optional[List[str]] = None) -> str:
    """Agent tool to catalog a document, url content, or meeting transcript into the knowledge base."""
    try:
        embedding = await get_embedding(content)
        await add_knowledge(
            workspace_id=workspace_id,
            title=title,
            content=content,
            embedding=embedding,
            source_url=source_url,
            source_type=source_type,
            tags=tags
        )
        return f"Successfully added '{title}' to workspace knowledge base."
    except Exception as e:
        return f"Failed to add knowledge item: {str(e)}"

async def query_knowledge_tool(workspace_id: str, query: str, limit: int = 5) -> str:
    """Agent tool to search the workspace knowledge base for documents, pages, and transcripts."""
    try:
        embedding = await get_embedding(query)
        matches = await search_knowledge(workspace_id, embedding, limit=limit)
        if not matches:
            return "No relevant knowledge base items found."
            
        output = ["**Relevant Knowledge Base Records:**"]
        for k in matches:
            score = round(k['similarity'] * 100, 1)
            title = k.get("title") or "Untitled"
            snippet = k['content'][:200] + "..." if len(k['content']) > 200 else k['content']
            output.append(f"- **{title}** ({score}% matches)\n  Content: {snippet}")
        return "\n".join(output)
    except Exception as e:
        return f"Knowledge search error: {str(e)}"
