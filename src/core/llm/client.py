import logging
import httpx
from typing import List, Dict, Any, Optional, Tuple
from src.core.llm.rotators import ResilientOllamaRotator

logger = logging.getLogger("klawhub.core.llm.client")

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
    """Resilient, multi-tenant conscious client that executes LLM requests via rotating endpoints.
    
    Includes automatic failover retries and captures usage statistics.
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
        max_retries: int = 1
    ) -> Dict[str, Any]:
        """Executes a chat completion request with auto-failover, backoff, and rotator tracking."""
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

            payload = {
                "model": model,
                "messages": compiled_messages,
                "temperature": temperature,
                "stream": False
            }

            logger.info(f"Issuing chat completion to host: {url} (Attempt {attempt + 1}/{max_retries})")
            
            try:
                # Lazy import inside completion loop to optimize serverless cold starts
                import httpx
                
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        f"{url.rstrip('/')}/chat/completions",
                        json=payload,
                        headers=headers
                    )
                    
                    if response.status_code == 200:
                        data = response.json()
                        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                        usage = data.get("usage", {})
                        
                        return {
                            "content": content,
                            "usage": {
                                "prompt_tokens": usage.get("prompt_tokens", 0),
                                "completion_tokens": usage.get("completion_tokens", 0),
                                "total_tokens": usage.get("total_tokens", 0)
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

# Quick access global import helper to keep imports clean
import os
