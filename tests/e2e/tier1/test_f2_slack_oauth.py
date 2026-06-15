import pytest
import jwt
from urllib.parse import urlparse, parse_qs
from src.config import settings

def test_slack_oauth_redirect(client):
    """Test 1: GET /api/oauth/slack redirects to Slack's authorization server with correct parameters."""
    response = client.get("/api/oauth/slack", follow_redirects=False)
    assert response.status_code == 307
    location = response.headers["location"]
    parsed = urlparse(location)
    assert parsed.netloc == "slack.com"
    assert parsed.path == "/oauth/v2/authorize"
    params = parse_qs(parsed.query)
    assert params["client_id"][0] == (settings.SLACK_CLIENT_ID or "mock-slack-client-id")
    assert "commands,chat:write" in params["scope"][0]

def test_slack_oauth_callback_success(client):
    """Test 2: GET /api/oauth/callback?code=xxx successfully creates a workspace, issues cookie, and redirects."""
    response = client.get("/api/oauth/callback?code=mock_authorization_code", follow_redirects=False)
    assert response.status_code == 307
    location = response.headers["location"]
    assert "dashboard?install=success" in location
    
    # Check session cookie exists
    assert "session" in response.cookies
    jwt_token = response.cookies["session"]
    payload = jwt.decode(jwt_token, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])
    assert payload["slack_team_id"] == "T_MOCK_TEAM"
    assert payload["role"] == "admin"
    assert "workspace_id" in payload

def test_slack_oauth_callback_denied(client):
    """Test 3: GET /api/oauth/callback?error=xxx redirects to landing page with denied reason."""
    response = client.get("/api/oauth/callback?error=user_cancelled", follow_redirects=False)
    assert response.status_code == 307
    location = response.headers["location"]
    assert "?install=denied&reason=user_cancelled" in location

def test_slack_oauth_callback_missing_code(client):
    """Test 4: GET /api/oauth/callback without code/error raises 400."""
    response = client.get("/api/oauth/callback")
    assert response.status_code == 400
    assert response.json()["detail"] == "Missing code"

def test_jwt_cookie_contents(client):
    """Test 5: Verify that the JWT payload is properly formatted and secure."""
    response = client.get("/api/oauth/callback?code=somecode", follow_redirects=False)
    jwt_token = response.cookies["session"]
    
    header = jwt.get_unverified_header(jwt_token)
    assert header["alg"] == "HS256"
    
    payload = jwt.decode(jwt_token, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])
    assert payload["sub"] == "user-123"
    assert payload["role"] == "admin"
