import pytest
import json
import respx
import httpx
from urllib.parse import urlparse, parse_qs
from src.config import settings
from src.core.security.encryptor import encryptor
from src.core.tools.google_tools import (
    _get_google_access_token,
    list_calendar_events_tool,
    list_drive_files_tool
)
from src.db.operations import execute_statement

def test_google_oauth_redirect(client):
    """Test 1: Verify Google OAuth redirect URL and query parameters."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    response = client.get(f"/api/oauth/google?workspace_id={workspace_id}", follow_redirects=False)
    assert response.status_code == 307
    location = response.headers["location"]
    parsed = urlparse(location)
    assert parsed.netloc == "accounts.google.com"
    assert parsed.path == "/o/oauth2/v2/auth"
    params = parse_qs(parsed.query)
    
    assert params["client_id"][0] == (settings.GOOGLE_CLIENT_ID or "mock-google-client-id")
    assert params["state"][0] == workspace_id
    assert params["response_type"][0] == "code"
    
    scopes = params["scope"][0].split(" ")
    assert "https://www.googleapis.com/auth/calendar" in scopes
    assert "https://www.googleapis.com/auth/drive" in scopes
    assert "https://www.googleapis.com/auth/gmail.readonly" in scopes

@pytest.mark.anyio
async def test_google_oauth_callback(client):
    """Test 2: Verify Google OAuth callback inserts encrypted token in the database."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    response = client.get(f"/api/oauth/google/callback?code=google_auth_code&state={workspace_id}", follow_redirects=False)
    assert response.status_code == 307
    assert "dashboard/settings?google=connected" in response.headers["location"]
    
    # Verify DB contains the record
    from tests.conftest import MOCK_DB
    integrations = MOCK_DB["integrations"]
    assert len(integrations) == 1
    assert integrations[0]["workspace_id"] == workspace_id
    assert integrations[0]["provider"] == "google"
    
    # Verify decryption
    decrypted = encryptor.decrypt(integrations[0]["access_token"])
    assert decrypted == "mock-google-access-token"

def test_google_token_encryption_decryption():
    """Test 3: Verify the AES-256-GCM encryption/decryption properties directly."""
    secret_token = "google_super_secret_access_token_123456"
    ciphertext = encryptor.encrypt(secret_token)
    assert ciphertext != secret_token
    
    plaintext = encryptor.decrypt(ciphertext)
    assert plaintext == secret_token

@pytest.mark.anyio
async def test_google_tools_token_retrieval():
    """Test 4: Verify _get_google_access_token retrieves and decrypts the token."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    # Seed token in DB
    encrypted_token = encryptor.encrypt("real-google-token-456")
    await execute_statement(
        "INSERT INTO integrations (workspace_id, provider, access_token) VALUES ($1, 'google', $2)",
        workspace_id, encrypted_token
    )
    
    retrieved = await _get_google_access_token(workspace_id)
    assert retrieved == "real-google-token-456"

@respx.mock
@pytest.mark.anyio
async def test_google_api_tools_calls():
    """Test 5: Verify Google tool functions make correct requests using mock access token."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    encrypted_token = encryptor.encrypt("google-test-token")
    await execute_statement(
        "INSERT INTO integrations (workspace_id, provider, access_token) VALUES ($1, 'google', $2)",
        workspace_id, encrypted_token
    )
    
    # Mock Calendar API
    respx.get("https://www.googleapis.com/calendar/v3/calendars/primary/events").mock(
        return_value=httpx.Response(200, json={"items": [{"summary": "Sprint Planning", "start": {"dateTime": "2026-06-15T12:00:00Z"}}]})
    )
    
    # Mock Drive API
    respx.get("https://www.googleapis.com/drive/v3/files").mock(
        return_value=httpx.Response(200, json={"files": [{"name": "Report.pdf", "mimeType": "application/pdf"}]})
    )
    
    calendar_res = await list_calendar_events_tool(workspace_id)
    assert "Sprint Planning" in calendar_res
    
    drive_res = await list_drive_files_tool(workspace_id)
    assert "Report.pdf" in drive_res
