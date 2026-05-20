import importlib
import pkgutil
import logging
from typing import Dict, Type

logger = logging.getLogger("klawhub.integrations.registry")

class ProviderRegistry:
    # Maps lowercase provider name to the client class inheriting from BaseAPIClient
    _registry: Dict[str, Type] = {}

    @classmethod
    def register(cls, name: str):
        """Decorator to dynamically register an integration provider client class."""
        def decorator(subclass: Type):
            cls._registry[name.lower()] = subclass
            logger.info(f"Successfully registered micro-package provider: {name.lower()} -> {subclass.__name__}")
            return subclass
        return decorator

    @classmethod
    def get_provider(cls, name: str) -> Type:
        """Retrieves a registered provider class. Lazy-loads discovery on the first call."""
        name_lower = name.lower()
        
        # Optimize Vercel cold starts by directly attempting to lazy-import the provider module first
        if name_lower not in cls._registry:
            try:
                importlib.import_module(f"src.integrations.providers.{name_lower}")
                logger.debug(f"Direct lazy-import successful for provider: {name_lower}")
            except Exception as e:
                logger.debug(f"Direct lazy-import for provider '{name_lower}' failed: {e}. Falling back to full discovery.")

        if not cls._registry:
            cls.discover_providers()
        if name_lower not in cls._registry:
            raise ValueError(f"Provider micro-package '{name_lower}' is not registered in the system.")
        return cls._registry[name_lower]

    @classmethod
    def discover_providers(cls):
        """Performs runtime dynamic package discovery under src/integrations/providers/."""
        import src.integrations.providers as providers
        logger.info("Initializing runtime dynamic provider discovery...")
        
        # Traverse through all child subdirectories in the providers package path
        for _, name, ispkg in pkgutil.iter_modules(providers.__path__):
            if ispkg and name != "base_client":
                try:
                    # Dynamically import the providers subpackage
                    # The client files inside should import and run their @ProviderRegistry.register decorators
                    importlib.import_module(f"src.integrations.providers.{name}")
                    logger.debug(f"Dynamic import successful for sub-package: {name}")
                except Exception as e:
                    logger.error(f"Failed to dynamically import micro-package '{name}': {str(e)}")
stream = None
