import os
import sys
import asyncio
import logging

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("verify_sandbox_tiering")

# Mock environment variables
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("UPSTASH_REDIS_REST_URL", "https://mock-redis.upstash.io")
os.environ.setdefault("UPSTASH_REDIS_REST_TOKEN", "mock_token")
os.environ.setdefault("SLACK_SIGNING_SECRET", "mock_slack_signing_secret")
os.environ.setdefault("SLACK_BOT_TOKEN", "xoxb-mock-bot-token")
os.environ.setdefault("MODAL_FUNCTION_URL", "https://mock-modal.run")
os.environ.setdefault("MODAL_WEBHOOK_SECRET", "mock_modal_secret")
os.environ.setdefault("INTEGRATION_ENCRYPTION_KEY", "mock_integration_encryption_key_32_bytes!!")
os.environ.setdefault("STATE_SIGNING_KEY", "test_state_signing_key_secure_12345")

from src.core.evolution.compiler import EvolutionCompiler, ASTSafetyScanner, SecurityError
from src.integrations.sandbox import SandboxClient


class MockResponse:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text

    def json(self):
        import json
        return json.loads(self.text)


async def test_ast_safety_scanner_whitelist():
    """Verify that new scientific and utility libraries are permitted in the whitelist scanner."""
    logger.info("=" * 60)
    logger.info("TEST 1: Verifying new whitelisted scientific & ML modules")
    logger.info("=" * 60)

    safe_payloads = [
        ("Importing scipy and performing operations", "import scipy\noutput = scipy.__version__"),
        ("Importing torch", "import torch\nx = torch.tensor([1, 2, 3])"),
        ("Importing pandas, numpy and polars", "import pandas\nimport numpy\nimport polars"),
        ("Using standard uuid, hashlib, random", "import uuid\nimport hashlib\nimport random\nx = uuid.uuid4()"),
    ]

    for label, code in safe_payloads:
        try:
            scanner = ASTSafetyScanner(code)
            scanner.scan()
            logger.info(f"  [PASS] {label} whitelisted by safety scanner successfully.")
        except SecurityError as se:
            logger.error(f"  [FAIL] {label} was falsely blocked: {se}")
            raise se


async def test_sandbox_client_routing_and_dependency_extraction():
    """Verify that SandboxClient correctly parses imports to detect dependencies and promote tiers."""
    logger.info("=" * 60)
    logger.info("TEST 2: Verifying SandboxClient routing and dynamic dependencies")
    logger.info("=" * 60)

    # 1. Standard python task with standard/pre-installed imports should remain standard tier, zero dependencies
    client = SandboxClient()
    
    # We will override _generate_headers to capture the payload sent to Modal
    captured_payloads = []
    
    original_generate_headers = client._generate_headers
    def mock_generate_headers(payload_str: str):
        import json
        captured_payloads.append(json.loads(payload_str))
        return original_generate_headers(payload_str)
        
    client._generate_headers = mock_generate_headers

    # Let's test standard imports
    code_standard = """
import json
import math
import datetime
import pandas as pd
print("Hello world")
"""
    await client.execute_code(code_standard, language="python")
    
    assert len(captured_payloads) == 1, "Should have captured 1 request"
    p1 = captured_payloads[-1]
    assert p1["memory_tier"] == "standard", f"Standard task should be standard tier, got {p1['memory_tier']}"
    assert len(p1["dependencies"]) == 0, f"Standard/pre-installed packages should not be added to dependencies, got {p1['dependencies']}"
    logger.info("  [PASS] Standard code parsed correctly: memory_tier='standard', dependencies=[]")

    # 2. Importing non-pre-installed custom modules should add them to dependencies
    code_custom_deps = """
import requests
import feedparser
import sympy
print("Parsed feed")
"""
    await client.execute_code(code_custom_deps, language="python")
    p2 = captured_payloads[-1]
    assert p2["memory_tier"] == "standard", f"Custom standard package should remain standard tier, got {p2['memory_tier']}"
    # sympy and feedparser should be in dependencies, requests should NOT be since it's pre-installed
    assert "feedparser" in p2["dependencies"], "feedparser should be detected"
    assert "sympy" in p2["dependencies"], "sympy should be detected"
    assert "requests" not in p2["dependencies"], "requests is pre-installed, should not be included"
    logger.info(f"  [PASS] Custom imports detected correctly: dependencies={p2['dependencies']}")

    # 3. Importing heavy modules should auto-promote memory_tier to heavy
    code_heavy = """
import scipy.stats
import torch
print("Heavy machine learning code")
"""
    await client.execute_code(code_heavy, language="python")
    p3 = captured_payloads[-1]
    assert p3["memory_tier"] == "heavy", f"Heavy package (torch/scipy) should promote memory_tier to heavy, got {p3['memory_tier']}"
    logger.info("  [PASS] Heavy code auto-promoted correctly: memory_tier='heavy'")


async def main():
    try:
        await test_ast_safety_scanner_whitelist()
        await test_sandbox_client_routing_and_dependency_extraction()
        logger.info("=" * 60)
        logger.info("[ALL TESTS PASSED] verify_sandbox_tiering.py completed successfully!")
        logger.info("=" * 60)
        sys.exit(0)
    except Exception as e:
        logger.error(f"[TESTS FAILED] Verification suite failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
