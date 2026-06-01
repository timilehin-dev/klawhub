import logging
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlmodel import select
from src.db.pool import get_db_session
from src.db.models import Skill

logger = logging.getLogger("klawhub.core.tools.skill_control")

class SkillControl:
    """Multi-tenant safe skill management controller.
    
    Guarantees absolute workspace data isolation by enforcing workspace_id validation
    across all operations (create, list, toggle_status, delete).
    """

    @classmethod
    async def create_skill(
        cls,
        workspace_id: uuid.UUID,
        name: str,
        description: str,
        source_code: str,
        entrypoint: str = "handler",
        repo_url: Optional[str] = None,
        dependencies: Optional[str] = None
    ) -> Dict[str, Any]:
        """Creates and persists a new custom cognitive skill for the workspace."""
        clean_name = name.strip().lower().replace(" ", "_")
        logger.info(f"Creating skill '{clean_name}' for workspace {workspace_id}")
        
        async with get_db_session() as session:
            # Enforce unique name per workspace check
            stmt = select(Skill).where(
                Skill.workspace_id == workspace_id,
                Skill.name == clean_name
            )
            res = await session.execute(stmt)
            existing = res.scalar_one_or_none()
            
            if existing:
                return {
                    "status": "error",
                    "message": f"A skill named '{clean_name}' already exists in this workspace."
                }
            
            new_skill = Skill(
                workspace_id=workspace_id,
                name=clean_name,
                description=description,
                source_code=source_code,
                entrypoint=entrypoint,
                repo_url=repo_url,
                dependencies=dependencies,
                is_active=True
            )
            
            session.add(new_skill)
            await session.commit()
            
            logger.info(f"Successfully created custom skill {new_skill.id} ({clean_name}) for workspace {workspace_id}")
            return {
                "status": "success",
                "message": f"Custom skill '{clean_name}' created successfully.",
                "skill": {
                    "id": str(new_skill.id),
                    "name": new_skill.name,
                    "description": new_skill.description,
                    "entrypoint": new_skill.entrypoint,
                    "is_active": new_skill.is_active,
                    "created_at": new_skill.created_at.isoformat() if new_skill.created_at else None
                }
            }

    @classmethod
    async def list_skills(cls, workspace_id: uuid.UUID) -> List[Dict[str, Any]]:
        """Lists all skills securely scoped to the active workspace_id."""
        logger.info(f"Listing skills for workspace {workspace_id}")
        
        async with get_db_session() as session:
            statement = select(Skill).where(Skill.workspace_id == workspace_id).order_by(Skill.created_at.desc())
            result = await session.execute(statement)
            skills = result.scalars().all()
            
            return [
                {
                    "id": str(s.id),
                    "name": s.name,
                    "description": s.description,
                    "entrypoint": s.entrypoint,
                    "is_active": s.is_active,
                    "repo_url": s.repo_url,
                    "created_at": s.created_at.isoformat() if s.created_at else None
                }
                for s in skills
            ]

    @classmethod
    async def toggle_skill_status(
        cls,
        workspace_id: uuid.UUID,
        skill_id: uuid.UUID,
        is_active: bool
    ) -> Dict[str, Any]:
        """Toggles a skill's active status securely after verifying workspace ownership."""
        logger.info(f"Toggling active status of skill {skill_id} to {is_active} in workspace {workspace_id}")
        
        async with get_db_session() as session:
            statement = select(Skill).where(
                Skill.id == skill_id,
                Skill.workspace_id == workspace_id
            )
            result = await session.execute(statement)
            skill = result.scalar_one_or_none()
            
            if not skill:
                raise ValueError(f"Skill with ID '{skill_id}' not found in your workspace.")
                
            skill.is_active = is_active
            skill.updated_at = datetime.utcnow()
            await session.commit()
            
            logger.info(f"Skill {skill_id} active status updated to {is_active}")
            status_text = "active" if is_active else "paused"
            return {
                "status": "success",
                "message": f"Skill status is now '{status_text}'.",
                "skill_id": str(skill.id),
                "is_active": skill.is_active
            }

    @classmethod
    async def delete_skill(cls, workspace_id: uuid.UUID, skill_id: uuid.UUID) -> Dict[str, Any]:
        """Permanently deletes a skill record securely after verifying workspace ownership."""
        logger.info(f"Attempting to delete skill {skill_id} in workspace {workspace_id}")
        
        async with get_db_session() as session:
            statement = select(Skill).where(
                Skill.id == skill_id,
                Skill.workspace_id == workspace_id
            )
            result = await session.execute(statement)
            skill = result.scalar_one_or_none()
            
            if not skill:
                raise ValueError(f"Skill with ID '{skill_id}' not found in your workspace.")
                
            await session.delete(skill)
            await session.commit()
            
            logger.info(f"Successfully deleted skill {skill_id} from workspace {workspace_id}")
            return {
                "status": "success",
                "message": f"Skill has been successfully deleted.",
                "skill_id": str(skill_id)
            }
