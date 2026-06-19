import pytest
import jwt
import respx
import httpx
import base64
import io
import zipfile
from tests.conftest import MOCK_DB
from src.config import settings
from src.core.security.encryptor import encryptor
from src.db.operations import (
    seed_builtin_skills,
    get_workspace_member,
    create_workspace_member,
    list_tasks,
    log_usage,
    create_schedule,
    update_schedule
)

# 1. Onboarding Scenario
@pytest.mark.anyio
async def test_new_workspace_onboarding_scenario(client):
    """Scenario 1: New customer onboarding from Slack installation to seeding builtin skills."""
    # Step 1: Slack OAuth installation
    resp_slack = client.get("/api/oauth/callback?code=new_workspace_code", follow_redirects=False)
    assert resp_slack.status_code == 307
    jwt_token = resp_slack.cookies["session"]
    payload = jwt.decode(jwt_token, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])
    workspace_id = payload["workspace_id"]
    
    # Step 2: Onboard user as admin member
    await create_workspace_member(
        workspace_id=workspace_id,
        slack_user_id="U_ADMIN",
        slack_username="team_admin",
        role="admin",
        email="admin@company.com"
    )
    member = await get_workspace_member(workspace_id, "U_ADMIN")
    assert member["role"] == "admin"
    
    # Step 3: Seed built-in skills
    await seed_builtin_skills(workspace_id)
    skills = MOCK_DB["skills"]
    assert len(skills) == 6
    assert any(s["slug"] == "document_master" for s in skills)
    assert any(s["slug"] == "data_science" for s in skills)

# 2. Daily Standup Scheduler Scenario
@pytest.mark.anyio
async def test_daily_standup_scheduler_scenario(client):
    """Scenario 2: Create a daily standup schedule, verify updates, log usage, and manage tasks."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    # Step 1: Admin configures a standup schedule
    s_id = await create_schedule(
        workspace_id=ws_id,
        name="9AM Daily Standup",
        schedule_type="standup",
        cron_expr="0 9 * * 1-5",
        channel_id="C_STANDUP",
        payload={"prompt": "Please write your standup update!"},
        created_by="U_ADMIN"
    )
    
    # Step 2: Triggered event runs and logs usage
    await log_usage(
        workspace_id=ws_id,
        slack_user_id="U_ADMIN",
        agent_name="standup_agent",
        skill_used="automation_engine",
        sandbox_function=None,
        prompt_tokens=150,
        completion_tokens=200,
        latency_ms=1200,
        status="success"
    )
    
    # Step 3: Create a task for a workspace member to submit their update
    payload_task = {
        "title": "Submit Daily Standup Status",
        "description": "Write what you did yesterday and what you plan today",
        "status": "todo",
        "priority": "medium",
        "payload": {},
        "created_by": "standup_agent"
    }
    resp_task = client.post(f"/api/dashboard/tasks?workspace_id={ws_id}", json=payload_task)
    assert resp_task.status_code == 200
    t_id = resp_task.json()["id"]
    
    # Step 4: Member completes task
    client.put(f"/api/dashboard/tasks/{t_id}", json={"status": "done"})
    
    # Step 5: Verify task status is 'done'
    tasks = await list_tasks(ws_id)
    assert len(tasks) == 1
    assert tasks[0]["status"] == "done"

# 3. Developer GitHub Automation Scenario
@respx.mock
@pytest.mark.anyio
async def test_developer_github_automation_scenario(client):
    """Scenario 3: Connect GitHub, trigger repository listing workflow, and log usage statistics."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    # Step 1: Connect GitHub integration
    client.get(f"/api/oauth/github/callback?code=dev_code&state={ws_id}", follow_redirects=False)
    
    # Step 2: Mock GitHub API
    respx.get("https://api.github.com/installation/repositories").mock(
        return_value=httpx.Response(200, json={"repositories": [{"full_name": "org/repo", "description": "Dev project"}]})
    )
    
    # Step 3: Trigger workflow step that executes list_repos
    from src.core.tools.github_tools import list_repos_tool
    repos_output = await list_repos_tool(ws_id)
    assert "org/repo" in repos_output
    
    # Step 4: Log workflow usage
    await log_usage(
        workspace_id=ws_id,
        slack_user_id="U_DEV",
        agent_name="developer_agent",
        skill_used="fullstack_engineer",
        sandbox_function="list_repos_tool",
        prompt_tokens=250,
        completion_tokens=400,
        latency_ms=1800,
        status="success"
    )
    
    assert len(MOCK_DB["usage_logs"]) == 1
    assert MOCK_DB["usage_logs"][0]["workspace_id"] == ws_id
    assert MOCK_DB["usage_logs"][0]["total_tokens"] == 650

# 4. Custom Skill Installer Scenario
@respx.mock
@pytest.mark.anyio
async def test_custom_skill_github_installer_scenario(client):
    """Scenario 4: Install custom skill from GitHub, pass AST check, register, approve, and execute."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    # Create a mock zip file containing the custom skill
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED) as zip_file:
        skill_code = """
def handler(workspace_id: str, inputs: dict) -> dict:
    return {"message": "Hello from custom skill!"}
"""
        zip_file.writestr("skill_my_custom_tool.py", skill_code)
        zip_file.writestr("requirements.txt", "httpx>=0.25.0")
        zip_file.writestr("SKILL.md", "# My Custom Tool\nProvides custom helper logic.")
        
    zip_content = zip_buffer.getvalue()
    
    # Step 1: Mock the zipball download request
    respx.get("https://api.github.com/repos/org/custom-repo/zipball/main").mock(
        return_value=httpx.Response(200, content=zip_content)
    )
    
    # Step 2: Trigger custom skill installation via Inngest client workflow installer directly
    from src.workflows.skill_installer import install_skill_from_github
    from inngest import Step, Event
    
    class MockEvent:
        def __init__(self, data):
            self.data = data
            self.name = "skill/install"
            self.id = "evt-123"
            self.ts = 12345
    class MockContext:
        def __init__(self, data):
            self.event = MockEvent(data)
            self.run_id = "run-123"
            self.attempt = 0
            
    ctx = MockContext({
        "workspace_id": ws_id,
        "github_url": "https://github.com/org/custom-repo",
        "created_by": "U_ADMIN"
    })
    
    # Simulate Inngest execution step runner
    class MockStep(Step):
        def __init__(self):
            pass
        async def run(self, id: str, fn, *args, **kwargs):
            return await fn()
            
    step = MockStep()
    result = await install_skill_from_github(ctx, step)
    
    # Verify installation status
    assert result["status"] == "success"
    assert result["skill_slug"] == "my_custom_tool"
    
    # Verify skill is cataloged in DB as pending approval
    skills = MOCK_DB["skills"]
    assert len(skills) == 1
    assert skills[0]["slug"] == "my_custom_tool"
    assert skills[0]["activation_status"] == "pending_approval"
    
    # Step 3: Approve skill (mark activation_status = 'active')
    skills[0]["activation_status"] = "active"
    
    # Step 4: Verify custom skill is now active
    from src.db.operations import get_skill
    active_skill = await get_skill(ws_id, "my_custom_tool")
    assert active_skill is not None
    assert active_skill["activation_status"] == "active"


# 4b. Custom Skill Installer with Private Repo PAT
@respx.mock
@pytest.mark.anyio
async def test_private_repo_skill_installer_with_pat(client):
    """Scenario 4b: Install custom skill from a private GitHub repo using GITHUB_PAT."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    # Set GITHUB_PAT env var for this test
    import os
    os.environ["GITHUB_PAT"] = "ghp_mock_pat_token_12345"
    # Reimport settings to pick up the new env var
    from src.config import settings
    assert settings.GITHUB_PAT == "ghp_mock_pat_token_12345"
    
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr("skill_private_tool.py", """
def handler(workspace_id: str, inputs: dict) -> dict:
    return {"data": inputs.get("secret")}
""")
        zip_file.writestr("requirements.txt", "")
        zip_file.writestr("SKILL.md", "# Private Tool")
    zip_content = zip_buffer.getvalue()
    
    # Mock GitHub API — verify Authorization header includes the PAT
    def verify_pat(request):
        auth = request.headers.get("Authorization", "")
        assert "token ghp_mock_pat_token_12345" in auth, f"Missing PAT in Authorization header: {auth}"
        return httpx.Response(200, content=zip_content)
    
    respx.get("https://api.github.com/repos/org/private-repo/zipball/main").mock(
        side_effect=verify_pat
    )
    
    from src.workflows.skill_installer import install_skill_from_github
    from inngest import Step
    
    class MockEvent:
        def __init__(self, data):
            self.data = data
            self.name = "skill/install"
            self.id = "evt-456"
            self.ts = 67890
    class MockContext:
        def __init__(self, data):
            self.event = MockEvent(data)
            self.run_id = "run-456"
            self.attempt = 0
    
    ctx = MockContext({
        "workspace_id": ws_id,
        "github_url": "https://github.com/org/private-repo",
        "created_by": "U_ADMIN"
    })
    
    class MockStep(Step):
        def __init__(self):
            pass
        async def run(self, id: str, fn, *args, **kwargs):
            return await fn()
    
    step = MockStep()
    result = await install_skill_from_github(ctx, step)
    
    assert result["status"] == "success"
    assert result["skill_slug"] == "private_tool"
    assert any(s["slug"] == "private_tool" for s in MOCK_DB["skills"])
    
    # Clean up
    del os.environ["GITHUB_PAT"]


# 4c. Custom Skill Installer — AST rejection of dangerous code
@respx.mock
@pytest.mark.anyio
async def test_custom_skill_ast_rejection(client):
    """Scenario 4c: Verify AST scanner rejects dangerous code (eval, exec, subprocess)."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED) as zip_file:
        # Dangerous code using eval()
        zip_file.writestr("skill_malicious.py", """
def handler(workspace_id: str, inputs: dict) -> dict:
    result = eval(inputs.get("code", ""))
    return {"result": result}
""")
        zip_file.writestr("requirements.txt", "")
    zip_content = zip_buffer.getvalue()
    
    respx.get("https://api.github.com/repos/org/malicious/zipball/main").mock(
        return_value=httpx.Response(200, content=zip_content)
    )
    
    from src.workflows.skill_installer import install_skill_from_github
    
    class MockEvent:
        def __init__(self, data):
            self.data = data
            self.name = "skill/install"
            self.id = "evt-789"
            self.ts = 99999
    class MockContext:
        def __init__(self, data):
            self.event = MockEvent(data)
            self.run_id = "run-789"
            self.attempt = 0
    
    ctx = MockContext({
        "workspace_id": ws_id,
        "github_url": "https://github.com/org/malicious",
        "created_by": "U_ADMIN"
    })
    
    from inngest import Step
    class MockStep(Step):
        def __init__(self):
            pass
        async def run(self, id: str, fn, *args, **kwargs):
            return await fn()
    
    step = MockStep()
    result = await install_skill_from_github(ctx, step)
    
    # The AST scanner should reject the dangerous code
    assert result["status"] == "failed"
    assert "AST" in result.get("reason", "")
    assert len(MOCK_DB["skills"]) == 0

# 5. Multi-tenant Workspace Isolation Scenario
@pytest.mark.anyio
async def test_multi_tenant_workspace_isolation_scenario(client):
    """Scenario 5: Multi-tenant workspace isolation. Verify data never leaks between workspace A and B."""
    # Step 1: Register Team A and Team B (F2)
    resp_slack_a = client.get("/api/oauth/callback?code=code_team_a", follow_redirects=False)
    jwt_a = resp_slack_a.cookies["session"]
    ws_a = jwt.decode(jwt_a, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])["workspace_id"]
    
    resp_slack_b = client.get("/api/oauth/callback?code=code_team_b", follow_redirects=False)
    jwt_b = resp_slack_b.cookies["session"]
    ws_b = jwt.decode(jwt_b, settings.HMAC_SECRET or "mock-hmac-secret-key-12345", algorithms=["HS256"])["workspace_id"]
    
    # Step 2: Create a task in Workspace A and a schedule in Workspace B (F5)
    client.post(f"/api/dashboard/tasks?workspace_id={ws_a}", json={
        "title": "Task Team A Only", "description": "", "status": "todo", "priority": "high", "payload": {}, "created_by": "user"
    })
    
    await create_schedule(
        workspace_id=ws_b,
        name="Schedule Team B Only",
        schedule_type="backup",
        cron_expr="0 0 * * *",
        channel_id="C_B",
        payload={},
        created_by="user"
    )
    
    # Step 3: Query Workspace B tasks (should be 0)
    tasks_b = client.get(f"/api/dashboard/tasks?workspace_id={ws_b}").json()
    assert len(tasks_b) == 0
    
    # Step 4: Query Workspace A tasks (should be 1)
    tasks_a = client.get(f"/api/dashboard/tasks?workspace_id={ws_a}").json()
    assert len(tasks_a) == 1
    assert tasks_a[0]["title"] == "Task Team A Only"
    
    # Step 5: Query Workspace A schedules (should be 0)
    schedules_a = client.get(f"/api/dashboard/schedules?workspace_id={ws_a}").json()
    assert len(schedules_a) == 0
    
    # Step 6: Query Workspace B schedules (should be 1)
    schedules_b = client.get(f"/api/dashboard/schedules?workspace_id={ws_b}").json()
    assert len(schedules_b) == 1
    assert schedules_b[0]["name"] == "Schedule Team B Only"
