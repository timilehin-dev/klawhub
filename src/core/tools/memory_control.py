import logging
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlmodel import select
from sqlalchemy import text, or_
from src.db.pool import get_db_session
from src.db.models import Memory
from src.core.llm.client import LLMClient

logger = logging.getLogger("klawhub.core.tools.memory_control")

class MemoryControl:
    """Multi-tenant safe semantic memory management controller.
    
    Uses Modal-based fastembed to generate embeddings and persists them to the PGVector column.
    """

    @classmethod
    async def create_memory(
        cls,
        workspace_id: uuid.UUID,
        slack_user_id: str,
        content: str,
        category: str = "general"
    ) -> Dict[str, Any]:
        """Generates embeddings and persists a new semantic memory to the database."""
        logger.info(f"Creating memory for workspace {workspace_id} (category: {category})")
        
        # Generate text embedding using the Modal service
        embedding = await LLMClient.generate_embedding(content)
        
        new_memory = Memory(
            workspace_id=workspace_id,
            slack_user_id=slack_user_id,
            content=content,
            category=category,
            embedding=embedding if embedding else None
        )

        async with get_db_session() as session:
            session.add(new_memory)
            await session.commit()
            
            logger.info(f"Successfully saved semantic memory {new_memory.id}")
            return {
                "status": "success",
                "message": "Memory successfully recorded.",
                "memory": {
                    "id": str(new_memory.id),
                    "content": new_memory.content,
                    "category": new_memory.category,
                    "has_embedding": embedding is not None and len(embedding) > 0
                }
            }

    @classmethod
    async def search_memories(
        cls,
        workspace_id: uuid.UUID,
        query: str,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """Queries memories using pgvector similarity search with a keyword fallback."""
        logger.info(f"Searching memories for workspace {workspace_id}: '{query}'")
        
        # Generate text embedding
        query_vector = await LLMClient.generate_embedding(query)
        
        async with get_db_session() as session:
            if query_vector:
                try:
                    statement = select(Memory).where(
                        Memory.workspace_id == workspace_id,
                        Memory.embedding != None
                    ).order_by(text("embedding <=> :val")).params(val=query_vector).limit(limit)
                    
                    result = await session.execute(statement)
                    memories = result.scalars().all()
                    
                    logger.info(f"Discovered {len(memories)} relevant semantic memories via pgvector search.")
                    return [
                        {
                            "id": str(m.id),
                            "content": m.content,
                            "category": m.category,
                            "created_at": m.created_at.isoformat() if m.created_at else None
                        }
                        for m in memories
                    ]
                except Exception as e:
                    logger.error(f"Memory similarity search query error: {e}. Falling back to keyword search...")
            
            # Fallback to keyword search
            conditions = []
            for word in query.split():
                # Escape wildcards for safety
                escaped_word = word.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
                conditions.append(Memory.content.ilike(f"%{escaped_word}%", escape='\\'))  # type: ignore

            if not conditions:
                return []

            statement = select(Memory).where(
                Memory.workspace_id == workspace_id,
                or_(*conditions)
            ).limit(limit)
            result = await session.execute(statement)
            matches = result.scalars().all()
            
            return [
                {
                    "id": str(m.id),
                    "content": m.content,
                    "category": m.category,
                    "created_at": m.created_at.isoformat() if m.created_at else None
                }
                for m in matches
            ]

    @classmethod
    async def delete_memory(cls, workspace_id: uuid.UUID, memory_id: uuid.UUID) -> Dict[str, Any]:
        """Deletes a memory record securely scoped to the active workspace."""
        logger.info(f"Attempting to delete memory {memory_id} in workspace {workspace_id}")
        
        async with get_db_session() as session:
            statement = select(Memory).where(
                Memory.id == memory_id,
                Memory.workspace_id == workspace_id
            )
            result = await session.execute(statement)
            memory = result.scalar_one_or_none()
            
            if not memory:
                raise ValueError(f"Memory with ID '{memory_id}' not found in your workspace.")
                
            await session.delete(memory)
            await session.commit()
            
            logger.info(f"Successfully deleted memory {memory_id}")
            return {
                "status": "success",
                "message": "Memory successfully deleted.",
                "memory_id": str(memory_id)
            }
