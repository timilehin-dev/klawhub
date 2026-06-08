import logging
import os
import httpx
from typing import List, Dict, Any, Optional, Tuple
from src.core.llm.rotators import ResilientOllamaRotator

logger = logging.getLogger("klawhub.core.llm.client")


def _mode_default_read_timeout(mode: str) -> float:
    """Return a conservative read timeout tuned to expected prompt size by mode."""
    timeouts = {
        "STANDARD_CHAT": 90.0,
        "DEEP_INGESTION": 240.0,
        "VETERAN_ENGINEERING": 300.0,
    }
    return timeouts.get(mode.upper(), 180.0)

def _bounded_read_timeout(mode: str, timeout_seconds: Optional[float], deadline_epoch: Optional[float]) -> float:
    """Resolve timeout from explicit value, mode default, and absolute deadline."""
    import time

    read_timeout = float(timeout_seconds) if timeout_seconds is not None else _mode_default_read_timeout(mode)
    if deadline_epoch is not None:
        remaining = float(deadline_epoch) - time.time()
        # Leave a small cushion for response handling/retry bookkeeping.
        read_timeout = min(read_timeout, max(1.0, remaining - 2.0))
    return max(1.0, read_timeout)

class ContextTokenBudgeter:
    """Estimates and prunes prompt context to guarantee optimal token budgets.
    
    Structures prompts deterministically to maximize KV-Cache reuse:
    1. Static Prefix (System prompt, DB Schemas, Tool definitions)
    2. Dynamic Midsection (Historical conversations, document dumps)
    3. Interactive Suffix (Current query and task)
    """

    # Budgets by mode
    BUDGETS = {
        "STANDARD_CHAT": 8192,
        "DEEP_INGESTION": 131072,
        "VETERAN_ENGINEERING": 262144
    }

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Lightweight, serverless-safe estimation (approx. 4 characters per token)."""
        if not text:
            return 0
        return len(text) // 4

    @classmethod
    def compile_prompt(
        cls, 
        system_prompt: str, 
        history: List[Dict[str, str]], 
        user_query: str, 
        mode: str = "STANDARD_CHAT"
    ) -> List[Dict[str, str]]:
        """Assembles and prunes messages to fit within the designated token budget.
        
        Ensures the system prompt is always at the absolute beginning, and the active query
        is at the absolute end. Prunes historical messages in a sliding window if over budget.
        """
        budget = cls.BUDGETS.get(mode.upper(), 8192)
        
        # Calculate static and essential components
        prefix_tokens = cls.estimate_tokens(system_prompt)
        suffix_tokens = cls.estimate_tokens(user_query)
        essential_budget = prefix_tokens + suffix_tokens + 500  # Safe padding

        if essential_budget >= budget:
            # Over budget even without history. Increase mode dynamically or raise warning
            logger.warning(f"Essential prompt size ({essential_budget} tokens) exceeds budget ({budget}). Forcing higher limit.")
            budget = essential_budget + 1000

        # Start loading history in a sliding window (newest first)
        pruned_history: List[Dict[str, str]] = []
        current_history_tokens = 0
        allowed_history_budget = budget - essential_budget

        for msg in reversed(history):
            msg_tokens = cls.estimate_tokens(msg.get("content", ""))
            if current_history_tokens + msg_tokens <= allowed_history_budget:
                pruned_history.insert(0, msg)
                current_history_tokens += msg_tokens
            else:
                logger.info("Token budget exceeded. Sliding window pruned older conversation history.")
                break

        # Assemble compiled messages
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(pruned_history)
        messages.append({"role": "user", "content": user_query})
        
        return messages


class LLMClient:
    """Resilient, multi-tenant conscious client that executes LLM requests via the Ollama native API.
    
    Includes automatic failover retries and captures usage statistics.
    Uses the native Ollama /api/chat endpoint format.
    """

    def __init__(self):
        self.rotator = ResilientOllamaRotator()

    async def chat_completion(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        user_query: str,
        mode: str = "STANDARD_CHAT",
        temperature: float = 0.2,
        max_retries: int = 2,
        timeout_seconds: Optional[float] = None,
        deadline_epoch: Optional[float] = None
    ) -> Dict[str, Any]:
        """Executes a chat completion request with auto-failover, backoff, and rotator tracking.

        timeout_seconds and deadline_epoch are optional hardening knobs for callers that
        know their execution budget; omitting them preserves the historical API behavior.
        """
        compiled_messages = ContextTokenBudgeter.compile_prompt(system_prompt, history, user_query, mode)
        model = os.getenv("OLLAMA_MODEL", "gemma4:31b-cloud")
        if mode.upper() == "VETERAN_ENGINEERING":
            model = os.getenv("OLLAMA_ENGINEER_MODEL", "gemma4:31b-cloud")

        for attempt in range(max_retries):
            endpoint = self.rotator.get_next_endpoint()
            url = endpoint["url"]
            key = endpoint["key"]

            headers = {
                "Content-Type": "application/json"
            }
            if key:
                headers["Authorization"] = f"Bearer {key}"

            # Native Ollama /api/chat request format
            payload = {
                "model": model,
                "messages": compiled_messages,
                "stream": False,
                "options": {
                    "temperature": temperature
                }
            }

            api_url = f"{url.rstrip('/')}/api/chat"
            logger.info(f"Issuing chat completion to: {api_url} (Attempt {attempt + 1}/{max_retries}, mode={mode}, read_timeout={_bounded_read_timeout(mode, timeout_seconds, deadline_epoch):.1f}s)")

            try:
                read_timeout = _bounded_read_timeout(mode, timeout_seconds, deadline_epoch)
                connect_timeout = min(10.0, max(1.0, read_timeout / 3.0))
                write_timeout = min(10.0, max(1.0, read_timeout / 3.0))
                timeout = httpx.Timeout(
                    connect=connect_timeout,
                    read=read_timeout,
                    write=write_timeout,
                    pool=5.0
                )
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(
                        api_url,
                        json=payload,
                        headers=headers
                    )

                    if response.status_code == 200:
                        data = response.json()

                        # Native Ollama response format: data["message"]["content"]
                        content = data.get("message", {}).get("content", "")

                        # Extract usage stats from Ollama native response
                        prompt_eval_count = data.get("prompt_eval_count", 0)
                        eval_count = data.get("eval_count", 0)

                        return {
                            "content": content,
                            "usage": {
                                "prompt_tokens": prompt_eval_count,
                                "completion_tokens": eval_count,
                                "total_tokens": prompt_eval_count + eval_count
                            },
                            "host": url
                        }
                    else:
                        logger.warning(f"Ollama server returned error status {response.status_code}: {response.text}")
                        self.rotator.mark_failed(url)
            except Exception as e:
                logger.error(f"HTTP request to Ollama host '{url}' failed: {str(e)}")
                self.rotator.mark_failed(url)

        raise RuntimeError("All configured Ollama endpoints failed to respond to the request.")

    @classmethod
    async def generate_embedding(cls, text: str) -> List[float]:
        """Generates a text embedding vector (384-dimensional) via the Modal Sandbox's fastembed instance."""
        import json
        import base64
        import hmac
        import hashlib
        import time
        from src.config import settings

        payload = {
            "type": "generate_embedding",
            "text": text
        }
        payload_str = json.dumps(payload)
        
        # Sign payload + timestamp using HMAC SHA-256
        timestamp = str(int(time.time()))
        message = f"{payload_str}:{timestamp}".encode('utf-8')
        secret_bytes = settings.modal_webhook_secret.encode('utf-8')
        signature = hmac.new(secret_bytes, message, hashlib.sha256).hexdigest()
        
        headers = {
            "X-Webhook-Timestamp": timestamp,
            "X-Webhook-Signature": signature,
            "X-Webhook-Secret": settings.modal_webhook_secret,
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    settings.modal_function_url,
                    content=payload_str,
                    headers=headers
                )
                if response.status_code == 200:
                    result = response.json()
                    if result.get("success"):
                        return result.get("embedding", [])
                    else:
                        logger.error(f"Modal embedding generation returned failure: {result.get('error')}")
                else:
                    logger.error(f"Modal embedding generation HTTP error status {response.status_code}: {response.text}")
        except Exception as e:
            logger.error(f"Failed to generate embedding via Modal sandbox: {e}")
        return []

