import logging
from typing import Dict, Any, Callable
from src.core.evolution.compiler import EvolutionCompiler

logger = logging.getLogger("klawhub.core.evolution.registry")

class DynamicSkillRegistry:
    """Manages the in-memory life cycle of dynamic, hot-swappable enterprise skills."""
    
    # Store dynamic callable functions: name -> callable
    _registry: Dict[str, Callable] = {}
    # Store raw source code for audit/verification: name -> source_code
    _sources: Dict[str, str] = {}

    @classmethod
    def register_skill(cls, name: str, source_code: str, entrypoint_function: str = "handler", isolation_profile: str = "sandbox") -> None:
        """Compiles the source code with AST validation and binds the entrypoint to the registry."""
        normalized_name = name.lower().strip()
        
        try:
            # Compile and extract local namespace
            namespace = EvolutionCompiler.compile_skill(source_code, normalized_name, isolation_profile=isolation_profile)
            
            if entrypoint_function not in namespace:
                raise ValueError(
                    f"Entrypoint function '{entrypoint_function}' not found in the compiled namespace. "
                    f"Please define a def {entrypoint_function}(...) in your skill script."
                )
            
            cls._registry[normalized_name] = namespace[entrypoint_function]
            cls._sources[normalized_name] = source_code
            logger.info(f"Successfully registered dynamic hot-swapped skill entrypoint: '{normalized_name}' (profile: {isolation_profile})")
            
        except Exception as e:
            logger.error(f"Failed to register dynamic skill '{normalized_name}': {str(e)}")
            raise e

    @classmethod
    def get_skill(cls, name: str) -> Callable:
        """Fetches the callable entrypoint function for the requested skill."""
        normalized_name = name.lower().strip()
        if normalized_name not in cls._registry:
            raise KeyError(f"Dynamic skill '{normalized_name}' is not currently loaded in the registry.")
        return cls._registry[normalized_name]

    @classmethod
    def list_skills(cls) -> Dict[str, str]:
        """Returns list of registered skills and their active source codes."""
        return dict(cls._sources)

    @classmethod
    def clear_registry(cls) -> None:
        """Wipes the dynamic registry."""
        cls._registry.clear()
        cls._sources.clear()
        logger.info("Dynamic skills registry wiped.")
