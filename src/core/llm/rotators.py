import os
import logging
import random
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta
from src.config import settings

logger = logging.getLogger("klawhub.core.llm.rotators")

class ResilientOllamaRotator:
    """Rotates through multiple Ollama base URLs and API keys for elite high-throughput failover.
    
    Supports:
    - Comma-separated multi-host clusters in OLLAMA_BASE_URL.
    - Automatic cool-down tracking for failed hosts (cools down for 60 seconds).
    - Round-robin keys rotation.
    - Graceful fallback sequence.
    """

    def __init__(self):
        # Allow multi-host clustering by parsing comma-separated URLs
        raw_urls = settings.ollama_base_url
        self.hosts = [url.strip().rstrip("/") for url in raw_urls.split(",") if url.strip()]
        
        # Load keys from settings (loaded from environment vars)
        self.keys = settings.ollama_keys
        if not self.keys:
            # Fall back to checking standard environment vars directly
            self.keys = [
                k for k in [
                    os.getenv("OLLAMA_API_KEY_1"),
                    os.getenv("OLLAMA_API_KEY_2"),
                    os.getenv("OLLAMA_API_KEY_3"),
                    os.getenv("OLLAMA_API_KEY")
                ] if k
            ]
        
        # In-memory cooling registry: host -> cool-down expiry datetime
        self._cooling_hosts: Dict[str, datetime] = {}
        self._key_index = 0

    def _get_active_hosts(self) -> List[str]:
        """Returns the list of healthy hosts, checking and clearing expired cool-downs."""
        now = datetime.now(timezone.utc)
        healthy = []
        for host in self.hosts:
            cooldown_expiry = self._cooling_hosts.get(host)
            if cooldown_expiry:
                if now > cooldown_expiry:
                    logger.info(f"Ollama host '{host}' has completed its cool-down. Restoring to cluster.")
                    del self._cooling_hosts[host]
                    healthy.append(host)
            else:
                healthy.append(host)
        return healthy if healthy else self.hosts  # Fallback to all hosts if all are cooling down

    def mark_failed(self, host: str, duration_seconds: int = 60) -> None:
        """Puts a failing host into cool-down mode for the specified duration."""
        expiry = datetime.now(timezone.utc) + timedelta(seconds=duration_seconds)
        self._cooling_hosts[host] = expiry
        logger.warning(f"Ollama host '{host}' marked as FAILED. Cool-down active until {expiry.isoformat()}.")

    def get_next_endpoint(self) -> Dict[str, str]:
        """Returns the next healthy host and rotates the authorization key.
        
        Returns:
            Dict containing:
                "url": The base URL for the request
                "key": The authorization API key
        """
        active_hosts = self._get_active_hosts()
        # Pick a random host from active healthy list to load balance
        host = random.choice(active_hosts)

        # Select key in round-robin fashion
        key = ""
        if self.keys:
            key = self.keys[self._key_index % len(self.keys)]
            self._key_index += 1

        return {
            "url": host,
            "key": key
        }
