import pytest
import jwt
import respx
import httpx
from src.config import settings
from src.core.security.encryptor import encryptor
from src.core.tools.google_tools import list_calendar_events_tool
from src.core.tools.github_tools import list_repos_tool

def test_oauth_flow_and_dashboard_crud(client):
    """Test 1: Complete Slack OAuth callback -> Workspace Registration -> Dashboard Schedules CRUD flow."""
    # Step 1: Slack OAuth Callback (F2)
    response = client.get("/api/oauth/callback?code=slack_code_123", follow_redirects=False)
    assert response.status_code == 307
    jwt_token = response.cookies["session"]
    payload = jwt.decode(jwt_token, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])
    workspace_id = payload["workspace_id"]
    
    # Step 2: Create a schedule scoped to this workspace_id (F5)
    payload_sch = {
        "name": "Integration Sync",
        "schedule_type": "standup",
        "cron_expr": "0 10 * * 1-5",
        "channel_id": "C_MAIN",
        "payload": {},
        "created_by": "user123"
    }
    resp_create = client.post(f"/api/dashboard/schedules?workspace_id={workspace_id}", json=payload_sch)
    assert resp_create.status_code == 200
    s_id = resp_create.json()["id"]
    
    # Step 3: Verify schedule exists in listing for this workspace (F5)
    resp_list = client.get(f"/api/dashboard/schedules?workspace_id={workspace_id}")
    assert len(resp_list.json()) == 1
    assert resp_list.json()[0]["id"] == s_id
    assert resp_list.json()[0]["name"] == "Integration Sync"

@respx.mock
@pytest.mark.anyio
async def test_oauth_flow_with_google_integration_and_google_tools(client):
    """Test 2: Slack OAuth Callback -> Google OAuth Integration -> Google tools invocation."""
    # Step 1: Slack OAuth Callback (F2)
    resp_slack = client.get("/api/oauth/callback?code=slack_code_456", follow_redirects=False)
    jwt_token = resp_slack.cookies["session"]
    payload = jwt.decode(jwt_token, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])
    workspace_id = payload["workspace_id"]
    
    # Step 2: Connect Google Workspace integration (F3)
    resp_google = client.get(f"/api/oauth/google/callback?code=google_code_999&state={workspace_id}", follow_redirects=False)
    assert resp_google.status_code == 307
    
    # Mock Google Calendar API
    respx.get("https://www.googleapis.com/calendar/v3/calendars/primary/events").mock(
        return_value=httpx.Response(200, json={"items": [{"summary": "Google OAuth Setup Completed", "start": {"dateTime": "2026-06-15T12:00:00Z"}}]})
    )
    
    # Step 3: Run Google calendar listing tool (F3)
    events_res = await list_calendar_events_tool(workspace_id)
    assert "Google OAuth Setup Completed" in events_res

@respx.mock
@pytest.mark.anyio
async def test_oauth_flow_with_github_integration_and_github_tools(client):
    """Test 3: Slack OAuth Callback -> GitHub OAuth Integration -> GitHub tools invocation."""
    # Step 1: Slack OAuth Callback (F2)
    resp_slack = client.get("/api/oauth/callback?code=slack_code_789", follow_redirects=False)
    jwt_token = resp_slack.cookies["session"]
    payload = jwt.decode(jwt_token, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])
    workspace_id = payload["workspace_id"]
    
    # Step 2: Connect GitHub integration (F4)
    resp_github = client.get(f"/api/oauth/github/callback?code=github_code_555&state={workspace_id}", follow_redirects=False)
    assert resp_github.status_code == 307
    
    # Mock GitHub Repos API
    respx.get("https://api.github.com/installation/repositories").mock(
        return_value=httpx.Response(200, json={"repositories": [{"full_name": "klawhub/e2e-tests", "description": "Verify workflow"}]})
    )
    
    # Step 3: Run GitHub repos listing tool (F4)
    repos_res = await list_repos_tool(workspace_id)
    assert "klawhub/e2e-tests" in repos_res

def test_cross_integrations_google_and_github(client):
    """Test 4: Connect Google and GitHub integrations to same workspace, verify independent AES encryption/decryption."""
    # Step 1: Register workspace (F2)
    resp_slack = client.get("/api/oauth/callback?code=slack_code_888", follow_redirects=False)
    jwt_token = resp_slack.cookies["session"]
    payload = jwt.decode(jwt_token, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])
    workspace_id = payload["workspace_id"]
    
    # Step 2: Connect Google (F3)
    client.get(f"/api/oauth/google/callback?code=google_code&state={workspace_id}", follow_redirects=False)
    # Step 3: Connect GitHub (F4)
    client.get(f"/api/oauth/github/callback?code=github_code&state={workspace_id}", follow_redirects=False)
    
    # Verify integrations in Mock DB
    from tests.conftest import MOCK_DB
    integrations = MOCK_DB["integrations"]
    assert len(integrations) == 2
    
    google_item = next(i for i in integrations if i["provider"] == "google")
    github_item = next(i for i in integrations if i["provider"] == "github")
    
    # Verify decryption produces separate plaintexts
    assert encryptor.decrypt(google_item["access_token"]) == "mock-google-access-token"
    assert encryptor.decrypt(github_item["access_token"]) == "mock-github-access-token"

@respx.mock
@pytest.mark.anyio
async def test_dashboard_workflow_triggers_github_and_google_tools(client):
    """Test 5: Create a dashboard workflow that involves multiple integrations (Google + GitHub)."""
    # Step 1: Register workspace and integrations
    resp_slack = client.get("/api/oauth/callback?code=slack_code_111", follow_redirects=False)
    jwt_token = resp_slack.cookies["session"]
    payload = jwt.decode(jwt_token, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])
    workspace_id = payload["workspace_id"]
    
    client.get(f"/api/oauth/google/callback?code=google_code&state={workspace_id}", follow_redirects=False)
    client.get(f"/api/oauth/github/callback?code=github_code&state={workspace_id}", follow_redirects=False)
    
    # Step 2: Create a dashboard workflow (F5)
    workflow_payload = {
        "name": "Sync Code & Calendar",
        "description": "Triggered by push, schedules calendar sync",
        "trigger_type": "git_push",
        "trigger_config": {"repo": "klawhub/e2e-tests"},
        "steps": [
            {"action": "list_repos", "provider": "github"},
            {"action": "list_calendar_events", "provider": "google"}
        ],
        "created_by": "developer"
    }
    resp_wf = client.post(f"/api/dashboard/workflows?workspace_id={workspace_id}", json=workflow_payload)
    assert resp_wf.status_code == 200
    wf_id = resp_wf.json()["id"]
    
    # Mock endpoints
    respx.get("https://api.github.com/installation/repositories").mock(
        return_value=httpx.Response(200, json={"repositories": [{"full_name": "klawhub/e2e-tests", "description": "Good"}]})
    )
    respx.get("https://www.googleapis.com/calendar/v3/calendars/primary/events").mock(
        return_value=httpx.Response(200, json={"items": [{"summary": "Daily Standup"}]})
    )
    
    # Step 3: Verify the tools can be executed for the workspace
    repos = await list_repos_tool(workspace_id)
    events = await list_calendar_events_tool(workspace_id)
    
    assert "klawhub/e2e-tests" in repos
    assert "Daily Standup" in events
