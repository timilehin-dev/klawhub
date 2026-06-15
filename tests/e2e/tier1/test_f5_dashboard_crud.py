import pytest
from tests.conftest import MOCK_DB
from src.db.operations import (
    add_memory,
    search_memory,
    add_knowledge,
    search_knowledge
)

def test_schedule_crud_scoped(client):
    """Test 1: Verify schedules CRUD is properly scoped by workspace_id."""
    ws1 = "b3196921-28c3-4cc9-964f-fa775f5b3e6a"
    ws2 = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    # Create schedule in ws1
    payload = {
        "name": "Daily Standup",
        "schedule_type": "standup",
        "cron_expr": "0 9 * * 1-5",
        "channel_id": "C123",
        "payload": {"prompt": "What did you do?"},
        "created_by": "user1"
    }
    resp1 = client.post(f"/api/dashboard/schedules?workspace_id={ws1}", json=payload)
    assert resp1.status_code == 200
    s_id = resp1.json()["id"]
    
    # List schedules for ws2 (should be empty)
    resp_ws2 = client.get(f"/api/dashboard/schedules?workspace_id={ws2}")
    assert resp_ws2.status_code == 200
    assert len(resp_ws2.json()) == 0
    
    # List schedules for ws1 (should return 1)
    resp_ws1 = client.get(f"/api/dashboard/schedules?workspace_id={ws1}")
    assert resp_ws1.status_code == 200
    assert len(resp_ws1.json()) == 1
    assert resp_ws1.json()[0]["name"] == "Daily Standup"
    
    # Update schedule
    updates = {"name": "Daily Standup Updated"}
    resp_update = client.put(f"/api/dashboard/schedules/{s_id}", json=updates)
    assert resp_update.status_code == 200
    
    # Verify update
    resp_ws1_v2 = client.get(f"/api/dashboard/schedules?workspace_id={ws1}")
    assert resp_ws1_v2.json()[0]["name"] == "Daily Standup Updated"
    
    # Delete schedule
    resp_delete = client.delete(f"/api/dashboard/schedules/{s_id}")
    assert resp_delete.status_code == 200
    
    # Verify delete
    resp_ws1_v3 = client.get(f"/api/dashboard/schedules?workspace_id={ws1}")
    assert len(resp_ws1_v3.json()) == 0

def test_task_crud_scoped(client):
    """Test 2: Verify tasks CRUD is properly scoped by workspace_id."""
    ws1 = "b3196921-28c3-4cc9-964f-fa775f5b3e6a"
    ws2 = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    payload = {
        "title": "Fix bug",
        "description": "Important fix",
        "status": "todo",
        "priority": "high",
        "payload": {},
        "created_by": "user1"
    }
    resp1 = client.post(f"/api/dashboard/tasks?workspace_id={ws1}", json=payload)
    assert resp1.status_code == 200
    t_id = resp1.json()["id"]
    
    # List for ws2 (should be empty)
    assert len(client.get(f"/api/dashboard/tasks?workspace_id={ws2}").json()) == 0
    
    # List for ws1 (should have 1)
    res_ws1 = client.get(f"/api/dashboard/tasks?workspace_id={ws1}").json()
    assert len(res_ws1) == 1
    assert res_ws1[0]["title"] == "Fix bug"
    
    # Update task
    client.put(f"/api/dashboard/tasks/{t_id}", json={"status": "done"})
    res_ws1_v2 = client.get(f"/api/dashboard/tasks?workspace_id={ws1}").json()
    assert res_ws1_v2[0]["status"] == "done"
    
    # Delete task
    client.delete(f"/api/dashboard/tasks/{t_id}")
    assert len(client.get(f"/api/dashboard/tasks?workspace_id={ws1}").json()) == 0

def test_workflow_crud_scoped(client):
    """Test 3: Verify workflows CRUD is properly scoped by workspace_id."""
    ws1 = "b3196921-28c3-4cc9-964f-fa775f5b3e6a"
    ws2 = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    payload = {
        "name": "Deployment pipeline",
        "description": "Builds and deploys",
        "trigger_type": "git_push",
        "trigger_config": {"branch": "main"},
        "steps": [{"action": "build"}, {"action": "test"}],
        "created_by": "user1"
    }
    resp1 = client.post(f"/api/dashboard/workflows?workspace_id={ws1}", json=payload)
    assert resp1.status_code == 200
    w_id = resp1.json()["id"]
    
    # List for ws2 (should be empty)
    assert len(client.get(f"/api/dashboard/workflows?workspace_id={ws2}").json()) == 0
    
    # List for ws1 (should have 1)
    res_ws1 = client.get(f"/api/dashboard/workflows?workspace_id={ws1}").json()
    assert len(res_ws1) == 1
    assert res_ws1[0]["name"] == "Deployment pipeline"
    
    # Update workflow
    client.put(f"/api/dashboard/workflows/{w_id}", json={"name": "Pipeline V2"})
    res_ws1_v2 = client.get(f"/api/dashboard/workflows?workspace_id={ws1}").json()
    assert res_ws1_v2[0]["name"] == "Pipeline V2"
    
    # Delete workflow
    client.delete(f"/api/dashboard/workflows/{w_id}")
    assert len(client.get(f"/api/dashboard/workflows?workspace_id={ws1}").json()) == 0

@pytest.mark.anyio
async def test_memory_crud_scoped():
    """Test 4: Verify memory retrieval and search scope checks by workspace ID."""
    ws1 = "b3196921-28c3-4cc9-964f-fa775f5b3e6a"
    ws2 = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    # Add memory to ws1
    await add_memory(
        workspace_id=ws1,
        slack_user_id="U123",
        content="I prefer dark mode.",
        embedding=[0.1, 0.2, 0.3],
        memory_type="observation"
    )
    
    # Search in ws2 (should be empty)
    res2 = await search_memory(workspace_id=ws2, query_embedding=[0.1, 0.2, 0.3])
    assert len(res2) == 0
    
    # Search in ws1 (should have 1)
    res1 = await search_memory(workspace_id=ws1, query_embedding=[0.1, 0.2, 0.3])
    assert len(res1) == 1
    assert res1[0]["content"] == "I prefer dark mode."

@pytest.mark.anyio
async def test_knowledge_crud_scoped():
    """Test 5: Verify knowledge search scope checks by workspace ID."""
    ws1 = "b3196921-28c3-4cc9-964f-fa775f5b3e6a"
    ws2 = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    
    # Add knowledge to ws1
    await add_knowledge(
        workspace_id=ws1,
        title="Coding Guide",
        content="Write clean code.",
        embedding=[0.1, 0.2, 0.3],
        source_url="http://guide.org"
    )
    
    # Search in ws2 (should be empty)
    res2 = await search_knowledge(workspace_id=ws2, query_embedding=[0.1, 0.2, 0.3])
    assert len(res2) == 0
    
    # Search in ws1 (should have 1)
    res1 = await search_knowledge(workspace_id=ws1, query_embedding=[0.1, 0.2, 0.3])
    assert len(res1) == 1
    assert res1[0]["content"] == "Write clean code."
