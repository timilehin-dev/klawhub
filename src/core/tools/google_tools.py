"""
Google Workspace integration tools (Calendar + Drive).

Retrieves encrypted access tokens from the `integrations` table,
decrypts them, and calls the Google REST API.

Function names match the TOOLS registry in general.py.
"""
import httpx
from typing import Optional
from src.db.operations import execute_query
from src.core.security.encryptor import encryptor


async def _get_google_access_token(workspace_id: str) -> str:
    """Retrieves and decrypts the Google OAuth access token for this workspace."""
    rows = await execute_query(
        "SELECT * FROM integrations WHERE workspace_id = $1::uuid AND provider = 'google' LIMIT 1",
        workspace_id,
    )
    if not rows:
        raise ValueError("Google integration not configured for this workspace.")
    encrypted_token = dict(rows[0]).get("access_token")
    if not encrypted_token:
        raise ValueError("Google access token missing.")
    return encryptor.decrypt(encrypted_token)


async def list_calendar_events_tool(workspace_id: str, max_results: int = 10) -> str:
    """Lists upcoming events from the workspace's primary Google Calendar."""
    try:
        token = await _get_google_access_token(workspace_id)
        url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        params = {
            "maxResults": max_results,
            "orderBy": "startTime",
            "singleEvents": "true",
            "timeMin": _now_iso(),
        }
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            if resp.status_code == 200:
                events = resp.json().get("items", [])
                if not events:
                    return "No upcoming calendar events found."
                lines = ["**Upcoming Google Calendar Events:**"]
                for e in events:
                    start = e.get("start", {}).get("dateTime") or e.get("start", {}).get("date", "")
                    lines.append(f"- **{e.get('summary', 'Untitled')}** — {start}")
                return "\n".join(lines)
            return f"Google Calendar API error {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return f"Error listing calendar events: {e}"


async def create_calendar_event_tool(
    workspace_id: str,
    summary: str,
    start_datetime: str,
    end_datetime: str,
    description: Optional[str] = None,
) -> str:
    """Creates a new event on the workspace's primary Google Calendar."""
    try:
        token = await _get_google_access_token(workspace_id)
        url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        payload = {
            "summary": summary,
            "start": {"dateTime": start_datetime},
            "end": {"dateTime": end_datetime},
            "description": description or "",
        }
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code in (200, 201):
                html_link = resp.json().get("htmlLink", "")
                return f"✅ Event '{summary}' created. {html_link}"
            return f"Failed to create event: {resp.status_code} — {resp.text[:200]}"
    except Exception as e:
        return f"Error creating calendar event: {e}"


async def list_drive_files_tool(workspace_id: str, query: Optional[str] = None) -> str:
    """Lists files from the workspace's Google Drive."""
    try:
        token = await _get_google_access_token(workspace_id)
        url = "https://www.googleapis.com/drive/v3/files"
        params = {"pageSize": 15, "fields": "files(id,name,mimeType,modifiedTime)"}
        if query:
            params["q"] = f"name contains '{query}'"
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            if resp.status_code == 200:
                files = resp.json().get("files", [])
                if not files:
                    return "No files found on Google Drive."
                lines = ["**Google Drive Files:**"]
                for f in files:
                    lines.append(f"- **{f['name']}** (`{f['mimeType']}`) — modified {f.get('modifiedTime','?')}")
                return "\n".join(lines)
            return f"Google Drive API error {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return f"Error listing Drive files: {e}"


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
