import pytest
import respx
import httpx
from src.core.security.encryptor import encryptor
from src.core.tools.github_tools import list_repos_tool, list_github_issues_tool
from src.db.operations import execute_statement

def test_github_oauth_missing_workspace(client):
    """Test 1: Verify GitHub OAuth redirect handles missing workspace_id."""
    response = client.get("/api/oauth/github")
    assert response.status_code == 422  # validation error since state/workspace_id is required

def test_github_oauth_callback_bad_state(client):
    """Test 2: Verify GitHub OAuth callback behaves gracefully with invalid state parameters."""
    response = client.get("/api/oauth/github/callback?code=code123&state=")
    assert response.status_code == 307

def test_github_token_bad_decryption():
    """Test 3: Verify that attempting to decrypt a corrupted/tampered GitHub token raises ValueError."""
    bad_encrypted_str = "invalid_base64_or_bad_payload"
    with pytest.raises(Exception):
        encryptor.decrypt(bad_encrypted_str)

@respx.mock
@pytest.mark.anyio
async def test_github_api_http_error():
    """Test 4: Verify that GitHub tools handle API HTTP 403 or 401 errors gracefully."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    encrypted_token = encryptor.encrypt("github-token")
    
    # clear integrations to avoid key conflicts
    from tests.conftest import MOCK_DB
    MOCK_DB["integrations"].clear()
    
    await execute_statement(
        "INSERT INTO integrations (workspace_id, provider, access_token) VALUES ($1, 'github', $2)",
        workspace_id, encrypted_token
    )
    
    respx.get("https://api.github.com/installation/repositories").mock(
        return_value=httpx.Response(403, text="Rate limit exceeded")
    )
    
    res = await list_repos_tool(workspace_id)
    assert "GitHub API error 403" in res

@respx.mock
@pytest.mark.anyio
async def test_github_empty_repos():
    """Test 5: Verify that listing repositories returns a friendly message when zero repos exist."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    encrypted_token = encryptor.encrypt("github-token")
    
    # clear integrations to avoid key conflicts
    from tests.conftest import MOCK_DB
    MOCK_DB["integrations"].clear()
    
    await execute_statement(
        "INSERT INTO integrations (workspace_id, provider, access_token) VALUES ($1, 'github', $2)",
        workspace_id, encrypted_token
    )
    
    respx.get("https://api.github.com/installation/repositories").mock(
        return_value=httpx.Response(200, json={"repositories": []})
    )
    
    res = await list_repos_tool(workspace_id)
    assert res == "No repositories accessible."
