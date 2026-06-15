import pytest
import respx
import httpx
from src.core.security.encryptor import encryptor
from src.core.tools.google_tools import list_calendar_events_tool, list_drive_files_tool
from src.db.operations import execute_statement

def test_google_oauth_missing_workspace(client):
    """Test 1: Verify Google OAuth redirect endpoint handles missing workspace_id query param."""
    response = client.get("/api/oauth/google")
    assert response.status_code == 422  # validation error since it is required

def test_google_oauth_callback_bad_state(client):
    """Test 2: Verify Google OAuth callback behaves gracefully with invalid state parameters."""
    response = client.get("/api/oauth/google/callback?code=code123&state=")
    # It should still process or redirect. In our mock it uses the empty state as workspace_id.
    assert response.status_code == 307

def test_google_token_bad_decryption():
    """Test 3: Verify that attempting to decrypt a corrupted/tampered Google token raises ValueError."""
    bad_encrypted_str = "invalid_base64_or_bad_payload"
    with pytest.raises(Exception):
        encryptor.decrypt(bad_encrypted_str)

@respx.mock
@pytest.mark.anyio
async def test_google_api_http_error():
    """Test 4: Verify that Google tools handle Calendar and Drive API HTTP errors (401, 500) gracefully."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    encrypted_token = encryptor.encrypt("google-token")
    
    # clear integrations to avoid key conflicts
    from tests.conftest import MOCK_DB
    MOCK_DB["integrations"].clear()
    
    await execute_statement(
        "INSERT INTO integrations (workspace_id, provider, access_token) VALUES ($1, 'google', $2)",
        workspace_id, encrypted_token
    )
    
    # Mock Calendar API returning 401 Unauthorized
    respx.get("https://www.googleapis.com/calendar/v3/calendars/primary/events").mock(
        return_value=httpx.Response(401, text="Unauthorized token")
    )
    
    res = await list_calendar_events_tool(workspace_id)
    assert "Google Calendar API error 401" in res

@respx.mock
@pytest.mark.anyio
async def test_google_drive_api_http_error():
    """Test 5: Verify Google Drive API handles HTTP 500 internal server error gracefully."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    encrypted_token = encryptor.encrypt("google-token")
    
    # clear integrations
    from tests.conftest import MOCK_DB
    MOCK_DB["integrations"].clear()
    
    await execute_statement(
        "INSERT INTO integrations (workspace_id, provider, access_token) VALUES ($1, 'google', $2)",
        workspace_id, encrypted_token
    )
    
    # Mock Drive API returning 500
    respx.get("https://www.googleapis.com/drive/v3/files").mock(
        return_value=httpx.Response(500, text="Internal Server Error")
    )
    
    res = await list_drive_files_tool(workspace_id)
    assert "Google Drive API error 500" in res
