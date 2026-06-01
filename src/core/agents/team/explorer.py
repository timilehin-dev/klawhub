import logging
import uuid
import json
from typing import Dict, Any, List
from sqlmodel import select
from src.db.pool import get_db_session
from src.db.models import Knowledge, Memory

logger = logging.getLogger("klawhub.core.agents.team.explorer")

async def explorer_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Explorer Node: Multi-tenant vector RAG and semantic context gatherer.
    
    Strictly query-isolates search operations to the active workspace_id.
    """
    workspace_id_str = state.get("workspace_id")
    user_query = state.get("user_query")
    milestones = state.get("milestones", [])
    active_index = state.get("active_milestone_index", 0)

    workspace_id = uuid.UUID(str(workspace_id_str))

    logger.info(f"Explorer executing multi-tenant context search for workspace {workspace_id}")

    # Determine what exactly we are researching for the current active milestone
    current_milestone_desc = "General search"
    if active_index < len(milestones):
        current_milestone_desc = milestones[active_index].get("description", "")

    context_fragments = []

    async with get_db_session() as session:
        # Generate text embedding using fastembed Modal service
        from src.core.llm.client import LLMClient
        from sqlalchemy import text
        
        logger.info("Explorer generating embedding vector for pgvector similarity search...")
        query_vector = await LLMClient.generate_embedding(user_query)
        
        vector_search_success = False
        if query_vector:
            try:
                # 1. Fetch relevant explicit company knowledge using pgvector cosine similarity (<=>)
                knowledge_statement = select(Knowledge).where(
                    Knowledge.workspace_id == workspace_id,
                    Knowledge.embedding != None
                ).order_by(text("embedding <=> :val")).params(val=query_vector).limit(5)
                
                result = await session.execute(knowledge_statement)
                knowledge_records = result.scalars().all()
                
                for k in knowledge_records:
                    title = k.entity_name or "Untitled Knowledge"
                    data_dict = k.data or {}
                    content = data_dict.get("content") or data_dict.get("text") or json.dumps(data_dict)
                    context_fragments.append(f"[Knowledge File: {title}]\n{content}")
                    
                # 2. Fetch relevant past thread context memories using pgvector cosine similarity (<=>)
                memory_statement = select(Memory).where(
                    Memory.workspace_id == workspace_id,
                    Memory.embedding != None
                ).order_by(text("embedding <=> :val")).params(val=query_vector).limit(5)
                
                result = await session.execute(memory_statement)
                memory_records = result.scalars().all()
                
                for m in memory_records:
                    content = m.content or ""
                    context_fragments.append(f"[Past Interaction Memory]\nMemory: {content} (Category: {m.category})")
                    
                vector_search_success = True
                logger.info(f"Explorer pgvector search successful! Discovered {len(context_fragments)} vector matches.")
            except Exception as e:
                logger.error(f"Explorer pgvector search failed: {e}. Falling back to keyword search...")
                
        # Defensive fallback to naive keyword search if vector search is unavailable or fails
        if not vector_search_success:
            context_fragments = [] # reset
            # 1. Fallback Fetch explicit company knowledge
            knowledge_statement = select(Knowledge).where(
                Knowledge.workspace_id == workspace_id
            ).limit(5)
            result = await session.execute(knowledge_statement)
            knowledge_records = result.scalars().all()

            for k in knowledge_records:
                title = k.entity_name or "Untitled Knowledge"
                data_dict = k.data or {}
                content = data_dict.get("content") or data_dict.get("text") or json.dumps(data_dict)
                
                if any(word in title.lower() or word in content.lower() 
                       for word in user_query.lower().split()):
                    context_fragments.append(f"[Knowledge (Keyword Match): {title}]\n{content}")

            # 2. Fallback Fetch relevant past thread context memories
            memory_statement = select(Memory).where(
                Memory.workspace_id == workspace_id
            ).order_by(Memory.created_at.desc()).limit(10)
            result = await session.execute(memory_statement)
            memory_records = result.scalars().all()

            for m in memory_records:
                content = m.content or ""
                if any(word in content.lower() for word in user_query.lower().split()):
                    context_fragments.append(f"[Memory (Keyword Match)]\nMemory: {content} (Category: {m.category})")

    # Mark active milestone as completed or in-progress based on whether context was gathered
    updated_milestones = list(milestones)
    if active_index < len(updated_milestones) and updated_milestones[active_index].get("assigned_to") == "explorer":
        updated_milestones[active_index]["status"] = "completed"
        logger.info(f"Explorer finished milestone: '{updated_milestones[active_index]['description']}'")

    # Combine all discovered fragments safely
    new_context = "\n\n".join(context_fragments) if context_fragments else "No relevant database/memory context discovered."
    
    # Load into existing context_data
    existing_context = list(state.get("context_data", []))
    existing_context.append(new_context)

    return {
        "context_data": existing_context,
        "milestones": updated_milestones
    }
