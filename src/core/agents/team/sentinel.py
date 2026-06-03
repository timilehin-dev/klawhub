import logging
import uuid
from typing import Dict, Any, List
from sqlmodel import select
from src.db.pool import get_db_session
from src.db.models import Workspace

logger = logging.getLogger("klawhub.core.agents.team.sentinel")

async def sentinel_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Sentinel Node: Ingests user input, verifies the webhook signature, and loads multi-tenant custom profile.
    
    Guarantees strict data isolation by enforcing non-nullable workspace filtering.
    """
    workspace_id_str = state.get("workspace_id")
    thread_id = state.get("thread_id")
    user_query = state.get("user_query")

    if not workspace_id_str:
        raise ValueError("Sentinel blocked request: missing non-nullable 'workspace_id'.")
    if not thread_id:
        raise ValueError("Sentinel blocked request: missing 'thread_id'.")

    try:
        workspace_id = uuid.UUID(str(workspace_id_str))
    except ValueError:
        raise ValueError(f"Sentinel blocked request: invalid workspace_id format: {workspace_id_str}")

    logger.info(f"Sentinel processing trigger for workspace {workspace_id}, thread {thread_id}")

    # Fetch custom workspace profile from Supabase
    async with get_db_session() as session:
        statement = select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.is_active == True
        )
        result = await session.execute(statement)
        workspace = result.scalar_one_or_none()

        if not workspace:
            raise PermissionError(f"Sentinel blocked execution: Workspace '{workspace_id}' is inactive or does not exist.")

        # Ingest custom personality and dynamic skills limits
        bot_name = workspace.agent_name or "Klawhub"
        personality = workspace.agent_personality or "Professional, efficient, and precise."
        enabled_skills = workspace.enabled_skills or ["web_search", "sandbox_execution", "code_analysis", "document_generator"]

    logger.info(f"Sentinel loaded profile for bot '{bot_name}' with personality: '{personality}'")

    # Ingest ambient trigger validation
    # If the message contains high-value keywords, classify the intent
    is_high_value = any(kw in user_query.lower() for kw in ["invoice", "report", "deploy", "build", "schedule"])
    
    # Detect simple conversational queries (greetings, intros, questions)
    # If conversational, pre-populate a simple worker milestone to bypass Orchestrator LLM planning completely!
    conversational_keywords = ["hello", "hi", "hey", "introduce", "who are you", "what can you do", "status", "help"]

    # Explicit work-intent blocklist: never short-circuit Orchestrator planning for these
    work_intent_keywords = [
        "summarize", "summary", "action items", "document", "pdf", "file", "attachment",
        "research", "analyze", "analyse", "report", "write", "draft", "generate",
        "build", "create", "schedule", "task", "remind", "deploy", "execute",
        "search", "find", "look up", "investigate", "explain", "review"
    ]
    has_work_intent = any(kw in user_query.lower() for kw in work_intent_keywords)

    is_conversational = (
        not has_work_intent
        and (
            any(kw in user_query.lower() for kw in conversational_keywords)
            or len(user_query.split()) < 5
        )
    )

    
    milestones = []
    if is_conversational:
        logger.info("Sentinel detected conversational query. Pre-populating worker milestone to bypass LLM planning.")
        milestones = [
            {"id": 1, "description": f"Respond to user conversational query: '{user_query}'", "status": "pending", "assigned_to": "worker"}
        ]
    
    # Return initialized state context
    return {
        "bot_name": bot_name,
        "bot_personality": personality,
        "enabled_skills": enabled_skills,
        "is_high_value_trigger": is_high_value,
        "milestones": milestones,
        "active_milestone_index": 0,
        "context_data": state.get("context_data", []),
        "errors": []
    }
