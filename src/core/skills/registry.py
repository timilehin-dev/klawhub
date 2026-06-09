import logging
from typing import Dict, Any, Type

logger = logging.getLogger("klawhub.skills.registry")

class DynamicSkillRegistry:
    """
    Registry for managing dynamic, AST-compiled workspace skills.
    In the roadmap, skills are loaded at runtime and mapped per workspace.
    """
    _skills: Dict[str, Any] = {}

    @classmethod
    def register_skill(cls, name: str, compiled_code: Any):
        """Registers a dynamically compiled skill."""
        cls._skills[name] = compiled_code
        logger.info(f"Registered dynamic skill: {name}")

    @classmethod
    def get_skill(cls, name: str) -> Any:
        """Retrieves a registered dynamic skill."""
        if name not in cls._skills:
            raise ValueError(f"Skill '{name}' is not registered.")
        return cls._skills[name]
