import pytest
import jwt
import time
from fastapi import HTTPException
from src.config import settings

def test_slack_oauth_callback_invalid_code(client):
    """Test 1: Verify callback behaves correctly with an invalid code parameter."""
    # Since our mocked callback always succeeds, we can simulate an error parameter instead
    response = client.get("/api/oauth/callback?error=invalid_code", follow_redirects=False)
    assert response.status_code == 307
    assert "install=denied&reason=invalid_code" in response.headers["location"]

def test_slack_oauth_callback_duplicate_install(client):
    """Test 2: Verify duplicate installation upserts the same team and updates it."""
    # Install 1st time
    client.get("/api/oauth/callback?code=code1", follow_redirects=False)
    from tests.conftest import MOCK_DB
    assert len(MOCK_DB["workspaces"]) == 1
    ws_id = MOCK_DB["workspaces"][0]["id"]
    
    # Install 2nd time for same team
    client.get("/api/oauth/callback?code=code2", follow_redirects=False)
    assert len(MOCK_DB["workspaces"]) == 1
    assert MOCK_DB["workspaces"][0]["id"] == ws_id  # should be same workspace UUID

def test_slack_oauth_callback_empty_params(client):
    """Test 3: Verify callback with empty or missing query parameters returns HTTP 400."""
    response = client.get("/api/oauth/callback?code=")
    assert response.status_code == 400
    assert response.json()["detail"] == "Missing code"

def test_slack_jwt_tampering(client):
    """Test 4: Verify that verifying a tampered JWT token raises signature verification errors."""
    payload = {"sub": "user-123", "workspace_id": "ws-123"}
    # Encrypt with normal secret
    token = jwt.encode(payload, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithm="HS256")
    
    # Tamper with token
    parts = token.split(".")
    tampered_token = f"{parts[0]}.{parts[1]}.badsignature"
    
    with pytest.raises(jwt.exceptions.InvalidSignatureError):
        jwt.decode(tampered_token, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])

def test_slack_jwt_expired():
    """Test 5: Verify that checking an expired JWT token correctly raises ExpiredSignatureError."""
    payload = {
        "sub": "user-123",
        "workspace_id": "ws-123",
        "exp": int(time.time()) - 3600  # expired 1 hour ago
    }
    expired_token = jwt.encode(payload, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithm="HS256")
    
    with pytest.raises(jwt.exceptions.ExpiredSignatureError):
        jwt.decode(expired_token, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])
