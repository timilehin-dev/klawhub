import pytest
import sys
from fastapi.testclient import TestClient

def test_fastapi_app_configuration(client):
    """Test 1: Verify the FastAPI app configuration parameters."""
    assert client.app.title == "KlawHub Inngest Webhook Service"
    assert client.app.version == "2.0.0"

def test_settings_load():
    """Test 2: Verify settings load correctly with correct types and values."""
    from src.config import settings
    assert settings.OLLAMA_BASE_URL == "https://ollama.com/v1"
    assert settings.NEMOTRON_MODEL == "nemotron-3-ultra:cloud"
    assert len(settings.ENCRYPTION_KEY) == 64

def test_db_pool_lifecycle(client):
    """Test 3: Verify the pool lifecycle by checking db mock client."""
    from src.db.client import get_pool
    # Verify pool can be accessed without RuntimeError
    pool = get_pool()
    assert pool is not None

def test_dynamic_imports_correctness():
    """Test 4: Verify that core modules import cleanly without ModuleNotFoundError."""
    import src.core.security.encryptor
    import src.core.security.ast_scanner
    import src.db.operations
    import src.workflows.message_handler
    import src.workflows.proactive_loop
    import src.workflows.skill_installer
    
    assert src.core.security.encryptor.encryptor is not None
    assert src.db.operations.create_workspace is not None

def test_app_endpoints_registration(client):
    """Test 5: Verify the endpoints are properly registered on the app router."""
    routes = [route.path for route in client.app.routes]
    assert "/api/oauth/slack" in routes
    assert "/api/oauth/callback" in routes
    assert "/api/oauth/google" in routes
    assert "/api/oauth/github" in routes
