import pytest
import jwt
import respx
import httpx
import base64
import io
import zipfile
import conftest as _conftest
MOCK_DB = _conftest.MOCK_DB
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
    
    # Mock the zipball download + branch resolution
    respx.get("https://api.github.com/repos/org/custom-repo/branches/main").mock(
        return_value=httpx.Response(200, json={"name": "main"})
    )
    respx.get("https://api.github.com/repos/org/custom-repo/zipball/main").mock(
        return_value=httpx.Response(200, content=zip_content)
    )
    
    # Step 2: Trigger custom skill installation
    from src.workflows.skill_installer import install_skill_from_github as installer_fn
    # The @inngest_client.create_function decorator wraps the function —
    # access the raw handler via ._handler
    installer_raw = installer_fn._handler if hasattr(installer_fn, '_handler') else installer_fn
    from inngest import Step

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
    
    class MockStep(Step):
        def __init__(self):
            pass
        async def run(self, id: str, fn, *args, **kwargs):
            result = fn()
            # Handle both sync and async functions
            if hasattr(result, '__await__'):
                return await result
            return result
            
    step = MockStep()
    result = await installer_raw(ctx, step)
    
    # Verify installation status
    assert result["status"] == "success"
    assert result["mode"] == "hybrid"
    assert len(result["installed"]) >= 1
    assert any(i["slug"] == "my_custom_tool" for i in result["installed"])
    
    # Verify skill is cataloged in DB as pending approval
    skills = MOCK_DB["skills"]
    assert len(skills) >= 1
    python_skill = next(s for s in skills if s["slug"] == "my_custom_tool")
    assert python_skill["activation_status"] == "pending_approval"
    assert python_skill["skill_type"] == "custom"
    
    # Verify instruction skill was also created from SKILL.md
    instruction_skill = next((s for s in skills if s["slug"] != "my_custom_tool"), None)
    if instruction_skill:
        assert instruction_skill["skill_type"] == "instruction"
        assert instruction_skill["activation_status"] == "active"
    
    # Step 3: Approve skill (mark activation_status = 'active')
    python_skill["activation_status"] = "active"
    
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
    
    # Set GITHUB_PAT directly on the shared settings object
    # (cannot use env var because settings was already imported)
    import src.config
    src.config.settings.GITHUB_PAT = "ghp_mock_pat_token_12345"
    assert src.config.settings.GITHUB_PAT == "ghp_mock_pat_token_12345"
    
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
    def verify_pat_zipball(request):
        auth = request.headers.get("Authorization", "")
        assert "token ghp_mock_pat_token_12345" in auth, f"Missing PAT in Authorization header: {auth}"
        return httpx.Response(200, content=zip_content)
    
    def verify_pat_branch(request):
        auth = request.headers.get("Authorization", "")
        assert "token ghp_mock_pat_token_12345" in auth, f"Missing PAT in branch Auth header: {auth}"
        return httpx.Response(200, json={"name": "main"})
    
    respx.get("https://api.github.com/repos/org/private-repo/branches/main").mock(
        side_effect=verify_pat_branch
    )
    respx.get("https://api.github.com/repos/org/private-repo/zipball/main").mock(
        side_effect=verify_pat_zipball
    )
    
    from src.workflows.skill_installer import install_skill_from_github as installer_fn
    installer_raw = installer_fn._handler if hasattr(installer_fn, '_handler') else installer_fn
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
            result = fn()
            # Handle both sync and async functions
            if hasattr(result, '__await__'):
                return await result
            return result
    
    step = MockStep()
    result = await installer_raw(ctx, step)
    
    assert result["status"] == "success", f"Expected success, got: {result}"
    assert any(i["slug"] == "private_tool" for i in result["installed"])
    assert any(s["slug"] == "private_tool" for s in MOCK_DB["skills"])
    
    # Clean up
    src.config.settings.GITHUB_PAT = None


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
    
    respx.get("https://api.github.com/repos/org/malicious/branches/main").mock(
        return_value=httpx.Response(200, json={"name": "main"})
    )
    respx.get("https://api.github.com/repos/org/malicious/zipball/main").mock(
        return_value=httpx.Response(200, content=zip_content)
    )
    
    from src.workflows.skill_installer import install_skill_from_github as installer_fn
    installer_raw = installer_fn._handler if hasattr(installer_fn, '_handler') else installer_fn
    
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
            result = fn()
            # Handle both sync and async functions
            if hasattr(result, '__await__'):
                return await result
            return result
    
    step = MockStep()
    result = await installer_raw(ctx, step)
    
    # The AST scanner should reject the dangerous code
    assert result["status"] == "failed"
    assert "AST" in result.get("reason", "")
    # Verify no NEW skill was added from this malicious repo
    # (previous tests may have added skills to MOCK_DB)
    malicious_skills = [s for s in MOCK_DB["skills"] if "malicious" in s.get("slug", "")]
    assert len(malicious_skills) == 0


# 4d. Instruction Skill Installer — SKILL.md only
@respx.mock
@pytest.mark.anyio
async def test_instruction_skill_installer(client):
    """Scenario 4d: Install instruction skill from a SKILL.md-only repo (no Python code)."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr("skills/data-analysis/SKILL.md", """# Data Analysis
## Commands
### /data:analyze
Analyze a dataset and produce statistical insights.
""")
        zip_file.writestr("skills/visualization/SKILL.md", """# Visualization
## Commands
### /data:visualize
Create charts and graphs from data.
""")
    zip_content = zip_buffer.getvalue()
    
    respx.get("https://api.github.com/repos/org/instruction-repo/branches/main").mock(
        return_value=httpx.Response(200, json={"name": "main"})
    )
    respx.get("https://api.github.com/repos/org/instruction-repo/zipball/main").mock(
        return_value=httpx.Response(200, content=zip_content)
    )
    
    from src.workflows.skill_installer import install_skill_from_github as installer_fn
    installer_raw = installer_fn._handler if hasattr(installer_fn, '_handler') else installer_fn
    from inngest import Step
    
    class MockEvent:
        def __init__(self, data):
            self.data = data
            self.name = "skill/install"
            self.id = "evt-instr-1"
            self.ts = 11111
    class MockContext:
        def __init__(self, data):
            self.event = MockEvent(data)
    class MockStep(Step):
        def __init__(self):
            pass
        async def run(self, id: str, fn, *args, **kwargs):
            result = fn()
            # Handle both sync and async functions
            if hasattr(result, '__await__'):
                return await result
            return result
    
    ctx = MockContext({
        "workspace_id": ws_id,
        "github_url": "https://github.com/org/instruction-repo",
        "created_by": "U_ADMIN"
    })
    step = MockStep()
    result = await installer_raw(ctx, step)
    
    assert result["status"] == "success"
    assert result["mode"] == "instruction"
    assert len(result["installed"]) == 2
    assert all(i["status"] == "active" for i in result["installed"])
    assert all(i["type"] == "instruction" for i in result["installed"])
    
    # Verify both instruction skills were inserted into the DB
    db_slugs = [s["slug"] for s in MOCK_DB["skills"]]
    assert "data_analysis" in db_slugs
    assert "visualization" in db_slugs


# 4e. Handler Signature Validation Rejection
@respx.mock
@pytest.mark.anyio
async def test_handler_signature_validation(client):
    """Scenario 4e: Verify handler signature validation rejects wrong signatures."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED) as zip_file:
        # Handler with wrong signature (3 required args instead of 2)
        zip_file.writestr("skill_bad_signature.py", """
def handler(a: str, b: str, c: str) -> dict:
    return {"result": a + b + c}
""")
    zip_content = zip_buffer.getvalue()
    
    respx.get("https://api.github.com/repos/org/bad-sig-repo/branches/main").mock(
        return_value=httpx.Response(200, json={"name": "main"})
    )
    respx.get("https://api.github.com/repos/org/bad-sig-repo/zipball/main").mock(
        return_value=httpx.Response(200, content=zip_content)
    )
    
    from src.workflows.skill_installer import install_skill_from_github as installer_fn
    installer_raw = installer_fn._handler if hasattr(installer_fn, '_handler') else installer_fn
    from inngest import Step
    
    class MockEvent:
        def __init__(self, data):
            self.data = data
            self.name = "skill/install"
            self.id = "evt-sig-1"
            self.ts = 22222
    class MockContext:
        def __init__(self, data):
            self.event = MockEvent(data)
    class MockStep(Step):
        def __init__(self):
            pass
        async def run(self, id: str, fn, *args, **kwargs):
            result = fn()
            # Handle both sync and async functions
            if hasattr(result, '__await__'):
                return await result
            return result
    
    ctx = MockContext({
        "workspace_id": ws_id,
        "github_url": "https://github.com/org/bad-sig-repo",
        "created_by": "U_ADMIN"
    })
    step = MockStep()
    result = await installer_raw(ctx, step)
    
    assert result["status"] == "failed"
    assert "handler() must accept exactly 2 arguments" in result["reason"]
    # No skill from this repo should be in the DB with type 'custom'
    db_custom = [s for s in MOCK_DB["skills"] if s.get("slug") == "bad_signature"]
    assert len(db_custom) == 0


# 4f. Branch Fallback
@respx.mock
@pytest.mark.anyio
async def test_skill_installer_branch_fallback(client):
    """Scenario 4f: Verify the installer falls back from main to master branch."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr("skill_legacy_tool.py", """
def handler(workspace_id: str, inputs: dict) -> dict:
    return {"legacy": True}
""")
    zip_content = zip_buffer.getvalue()
    
    # main branch fails (404) → should fall back to master
    respx.get("https://api.github.com/repos/org/legacy-repo/branches/main").mock(
        return_value=httpx.Response(404)
    )
    respx.get("https://api.github.com/repos/org/legacy-repo/branches/master").mock(
        return_value=httpx.Response(200, json={"name": "master"})
    )
    respx.get("https://api.github.com/repos/org/legacy-repo/zipball/master").mock(
        return_value=httpx.Response(200, content=zip_content)
    )
    
    from src.workflows.skill_installer import install_skill_from_github as installer_fn
    installer_raw = installer_fn._handler if hasattr(installer_fn, '_handler') else installer_fn
    from inngest import Step
    
    class MockEvent:
        def __init__(self, data):
            self.data = data
            self.name = "skill/install"
            self.id = "evt-br-1"
            self.ts = 33333
    class MockContext:
        def __init__(self, data):
            self.event = MockEvent(data)
    class MockStep(Step):
        def __init__(self):
            pass
        async def run(self, id: str, fn, *args, **kwargs):
            result = fn()
            # Handle both sync and async functions
            if hasattr(result, '__await__'):
                return await result
            return result
    
    ctx = MockContext({
        "workspace_id": ws_id,
        "github_url": "https://github.com/org/legacy-repo",
        "created_by": "U_ADMIN"
    })
    step = MockStep()
    result = await installer_raw(ctx, step)
    
    assert result["status"] == "success"
    assert result["branch"] == "master"  # Falls back to master
    assert any(i["slug"] == "legacy_tool" for i in result["installed"])

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
