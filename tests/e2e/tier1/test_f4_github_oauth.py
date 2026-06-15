import pytest
import json
import respx
import httpx
from urllib.parse import urlparse, parse_qs
from src.config import settings
from src.core.security.encryptor import encryptor
from src.core.tools.github_tools import (
    _get_github_token,
    list_repos_tool,
    list_github_issues_tool,
    create_github_issue_tool,
    create_pull_request_tool
)
from src.db.operations import execute_statement

def test_github_oauth_redirect(client):
    """Test 1: Verify GitHub OAuth redirect URL and query parameters."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    response = client.get(f"/api/oauth/github?workspace_id={workspace_id}", follow_redirects=False)
    assert response.status_code == 307
    location = response.headers["location"]
    parsed = urlparse(location)
    assert parsed.netloc == "github.com"
    assert parsed.path == "/login/oauth/authorize"
    params = parse_qs(parsed.query)
    
    assert params["client_id"][0] == (settings.GITHUB_APP_CLIENT_ID or "mock-github-client-id")
    assert params["state"][0] == workspace_id

@pytest.mark.anyio
async def test_github_oauth_callback(client):
    """Test 2: Verify GitHub OAuth callback inserts encrypted token in the database."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    response = client.get(f"/api/oauth/github/callback?code=github_auth_code&state={workspace_id}", follow_redirects=False)
    assert response.status_code == 307
    assert "dashboard/settings?github=connected" in response.headers["location"]
    
    # Verify DB contains the record
    from tests.conftest import MOCK_DB
    integrations = MOCK_DB["integrations"]
    assert len(integrations) == 1
    assert integrations[0]["workspace_id"] == workspace_id
    assert integrations[0]["provider"] == "github"
    
    # Verify decryption
    decrypted = encryptor.decrypt(integrations[0]["access_token"])
    assert decrypted == "mock-github-access-token"

def test_github_token_encryption_decryption():
    """Test 3: Verify the AES-256-GCM encryption/decryption properties for GitHub directly."""
    secret_token = "ghp_super_secret_github_personal_access_token_12345"
    ciphertext = encryptor.encrypt(secret_token)
    assert ciphertext != secret_token
    
    plaintext = encryptor.decrypt(ciphertext)
    assert plaintext == secret_token

@pytest.mark.anyio
async def test_github_tools_token_retrieval():
    """Test 4: Verify _get_github_token retrieves and decrypts the token."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    # Seed token in DB
    encrypted_token = encryptor.encrypt("real-github-token-789")
    await execute_statement(
        "INSERT INTO integrations (workspace_id, provider, access_token) VALUES ($1, 'github', $2)",
        workspace_id, encrypted_token
    )
    
    retrieved = await _get_github_token(workspace_id)
    assert retrieved == "real-github-token-789"

@respx.mock
@pytest.mark.anyio
async def test_github_api_tools_calls():
    """Test 5: Verify GitHub tool functions make correct requests using mock access token."""
    workspace_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    encrypted_token = encryptor.encrypt("github-test-token")
    await execute_statement(
        "INSERT INTO integrations (workspace_id, provider, access_token) VALUES ($1, 'github', $2)",
        workspace_id, encrypted_token
    )
    
    # Mock Repos API
    respx.get("https://api.github.com/installation/repositories").mock(
        return_value=httpx.Response(200, json={"repositories": [{"full_name": "owner/repo", "description": "My project"}]})
    )
    
    # Mock Issues API
    respx.get("https://api.github.com/repos/owner/repo/issues").mock(
        return_value=httpx.Response(200, json=[{"number": 1, "title": "First issue", "html_url": "https://github.com/owner/repo/issues/1"}])
    )
    
    repos_res = await list_repos_tool(workspace_id)
    assert "owner/repo" in repos_res
    
    issues_res = await list_github_issues_tool(workspace_id, "owner/repo")
    assert "First issue" in issues_res
