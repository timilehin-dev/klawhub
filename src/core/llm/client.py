"""
Nemotron LLM client for KlawHub.

Wraps the OpenAI-compatible API exposed by Ollama / Nemotron with:
- Async chat completion
- Streaming token generation
- Automatic retry with exponential backoff (tenacity) for transient 5xx errors
- Token budget estimation
"""
import json
import httpx
import logging
from typing import List, Dict, Any, AsyncGenerator, Optional
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)
from src.config import settings

logger = logging.getLogger(__name__)

# Retry configuration: up to 3 attempts, exponential back-off 2s → 30s
_RETRY = dict(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError, httpx.TimeoutException)),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)


class LLMClient:
    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL.rstrip("/")
        self.model = settings.NEMOTRON_MODEL
        self.api_key = settings.OLLAMA_API_KEY

    def _headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def estimate_tokens(self, text: str) -> int:
        """Rough token estimate: 1 token ≈ 4 characters."""
        return max(1, len(text) // 4) if text else 0

    @retry(**_RETRY)
    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Non-streaming chat completion with automatic retry on transient errors.
        Retries up to 3 times with exponential back-off on 5xx / transport errors.
        """
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens

        url = f"{self.base_url}/chat/completions"
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(url, json=payload, headers=self._headers())
            response.raise_for_status()
            return response.json()

    async def chat_stream(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
    ) -> AsyncGenerator[str, None]:
        """Streaming token generation — yields delta content chunks as they arrive."""
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        url = f"{self.base_url}/chat/completions"

        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("POST", url, json=payload, headers=self._headers()) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        line = line[6:]
                    if line.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(line)
                        delta = data.get("choices", [{}])[0].get("delta", {})
                        if "content" in delta:
                            yield delta["content"]
                    except Exception:
                        continue


# Global singleton
llm_client = LLMClient()
