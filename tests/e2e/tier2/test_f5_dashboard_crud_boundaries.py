import pytest
from src.db.operations import update_schedule, update_task, update_workflow
from tests.conftest import MOCK_DB

def test_schedule_invalid_cron(client):
    """Test 1: Verify creating schedule behaves appropriately with empty or invalid fields."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    # Even if cron is invalid, the API creates it, but next run check might fail. We verify creation goes through.
    payload = {
        "name": "Invalid Cron Schedule",
        "schedule_type": "backup",
        "cron_expr": "invalid cron here",
        "channel_id": "C123",
        "payload": {},
        "created_by": "user1"
    }
    resp = client.post(f"/api/dashboard/schedules?workspace_id={ws_id}", json=payload)
    assert resp.status_code == 200
    assert "id" in resp.json()

def test_task_invalid_priority(client):
    """Test 2: Verify creating task allows arbitrary priority or status safely at the db level."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    payload = {
        "title": "Edge case task",
        "description": None,
        "status": "extremely_high_priority_status_value",
        "priority": "super_priority",
        "payload": {},
        "created_by": "user1"
    }
    resp = client.post(f"/api/dashboard/tasks?workspace_id={ws_id}", json=payload)
    assert resp.status_code == 200
    assert "id" in resp.json()

def test_workflow_malformed_steps(client):
    """Test 3: Verify workflows can store complex nested JSON payload structure without crash."""
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    payload = {
        "name": "Nested Workflow",
        "description": "Complex workflow",
        "trigger_type": "webhook",
        "trigger_config": {"nested": {"config": [1, 2, 3]}},
        "steps": [{"action": "run_python", "args": {"code": "print(1)"}}],
        "created_by": "user1"
    }
    resp = client.post(f"/api/dashboard/workflows?workspace_id={ws_id}", json=payload)
    assert resp.status_code == 200
    w_id = resp.json()["id"]
    
    # Retrieve and check trigger config was stored as dict
    res = client.get(f"/api/dashboard/workflows?workspace_id={ws_id}").json()
    assert res[0]["id"] == w_id
    assert res[0]["trigger_config"]["nested"]["config"] == [1, 2, 3]

def test_dashboard_unauthorized_workspace_access(client):
    """Test 4: Verify querying/manipulating data using random invalid workspace ID returns empty results."""
    random_ws = "00000000-0000-0000-0000-000000000000"
    resp = client.get(f"/api/dashboard/schedules?workspace_id={random_ws}")
    assert resp.status_code == 200
    assert len(resp.json()) == 0

@pytest.mark.anyio
async def test_sql_injection_protection_update(client):
    """Test 5: Verify whitelisting in _build_set_clause prevents SQL injection in update operations (Weakness #10)."""
    # 1. Create a workspace
    ws_id = "b3196921-28c3-4cc9-964f-fa775f5b3e6b"
    payload = {
        "name": "Test Schedule",
        "schedule_type": "standup",
        "cron_expr": "* * * * *",
        "channel_id": "C1",
        "payload": {},
        "created_by": "user1"
    }
    resp = client.post(f"/api/dashboard/schedules?workspace_id={ws_id}", json=payload)
    s_id = resp.json()["id"]
    
    # 2. Try to update a schedule with an injection column name
    # The whitelisting in _build_set_clause should filter out this invalid column
    # columns whitelisted for update_schedule: name, schedule_type, cron_expr, channel_id, payload, is_active, next_run_at
    updates = {
        "name": "Valid Name",
        "is_active; DROP TABLE schedules; --": True,  # SQL Injection attempt
    }
    
    # This should execute safely without crashing and without dropping the table
    await update_schedule(s_id, updates)
    
    # Verify the injection field was ignored, but the valid field 'name' was updated
    res = client.get(f"/api/dashboard/schedules?workspace_id={ws_id}").json()
    assert res[0]["name"] == "Valid Name"
    # Ensure the database wasn't dropped
    assert len(MOCK_DB["schedules"]) == 1
