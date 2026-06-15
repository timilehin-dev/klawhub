"""
Google Workspace integration tools (Calendar + Drive + Gmail).

Retrieves encrypted access tokens from the `integrations` table,
decrypts them, handles token refresh, and calls Google REST APIs.

Function names match the TOOLS registry in general.py.
"""
import httpx
import time
from typing import Optional
from src.db.operations import execute_query, execute_statement
from src.core.security.encryptor import encryptor
from src.config import settings


async def _get_google_credentials(workspace_id: str) -> dict:
    """Retrieves and decrypts the Google OAuth credentials for this workspace."""
    rows = await execute_query(
        "SELECT * FROM integrations WHERE workspace_id = $1::uuid AND provider = 'google' LIMIT 1",
        workspace_id,
    )
    if not rows:
        raise ValueError("Google integration not configured for this workspace.")
    
    row = dict(rows[0])
    encrypted_token = row.get("access_token")
    if not encrypted_token:
        raise ValueError("Google access token missing.")
    
    access_token = encryptor.decrypt(encrypted_token)
    
    # Check if token needs refresh
    expires_at = row.get("expires_at")
    if expires_at and isinstance(expires_at, (int, float)) and time.time() > expires_at - 300:
        # Token is expired or about to expire — try to refresh
        refresh_token_encrypted = row.get("refresh_token")
        if refresh_token_encrypted:
            refresh_token = encryptor.decrypt(refresh_token_encrypted)
            try:
                new_token = await _refresh_google_token(refresh_token)
                # Update stored tokens
                new_encrypted = encryptor.encrypt(new_token["access_token"])
                new_expires = time.time() + new_token.get("expires_in", 3600)
                await execute_statement(
                    "UPDATE integrations SET access_token = $2, expires_at = $3 WHERE workspace_id = $1::uuid AND provider = 'google'",
                    workspace_id, new_encrypted, new_expires,
                )
                # If a new refresh token was issued, update it too
                if new_token.get("refresh_token"):
                    new_refresh_encrypted = encryptor.encrypt(new_token["refresh_token"])
                    await execute_statement(
                        "UPDATE integrations SET refresh_token = $2 WHERE workspace_id = $1::uuid AND provider = 'google'",
                        workspace_id, new_refresh_encrypted,
                    )
                access_token = new_token["access_token"]
            except Exception:
                pass  # If refresh fails, proceed with existing token
    
    return {"access_token": access_token}


async def _refresh_google_token(refresh_token: str) -> dict:
    """Refreshes an expired Google access token using the refresh_token flow."""
    form_data = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post("https://oauth2.googleapis.com/token", data=form_data)
        if resp.status_code != 200:
            raise ValueError(f"Google token refresh failed: {resp.status_code}")
        return resp.json()


async def _google_headers(workspace_id: str) -> dict:
    """Builds auth headers for Google API calls."""
    creds = await _get_google_credentials(workspace_id)
    return {"Authorization": f"Bearer {creds['access_token']}"}


# ── Calendar Tools ──────────────────────────────────────────────────────────

async def list_calendar_events_tool(workspace_id: str, max_results: int = 10) -> str:
    """Lists upcoming events from the workspace's primary Google Calendar."""
    try:
        headers = await _google_headers(workspace_id)
        url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        params = {
            "maxResults": max_results,
            "orderBy": "startTime",
            "singleEvents": "true",
            "timeMin": _now_iso(),
        }
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
        headers = await _google_headers(workspace_id)
        headers["Content-Type"] = "application/json"
        url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        payload = {
            "summary": summary,
            "start": {"dateTime": start_datetime},
            "end": {"dateTime": end_datetime},
            "description": description or "",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code in (200, 201):
                html_link = resp.json().get("htmlLink", "")
                return f"✅ Event '{summary}' created. {html_link}"
            return f"Failed to create event: {resp.status_code} — {resp.text[:200]}"
    except Exception as e:
        return f"Error creating calendar event: {e}"


# ── Drive Tools ─────────────────────────────────────────────────────────────

async def list_drive_files_tool(workspace_id: str, query: Optional[str] = None) -> str:
    """Lists files from the workspace's Google Drive."""
    try:
        headers = await _google_headers(workspace_id)
        url = "https://www.googleapis.com/drive/v3/files"
        params = {"pageSize": "15", "fields": "files(id,name,mimeType,modifiedTime)"}
        if query:
            params["q"] = f"name contains '{query}'"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            if resp.status_code == 200:
                files = resp.json().get("files", [])
                if not files:
                    return "No files found on Google Drive."
                lines = ["**Google Drive Files:**"]
                for f in files:
                    lines.append(f"- **{f['name']}** (`{f.get('mimeType','?')}`) — modified {f.get('modifiedTime','?')}")
                return "\n".join(lines)
            return f"Google Drive API error {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return f"Error listing Drive files: {e}"


# ── Gmail Tools ─────────────────────────────────────────────────────────────

async def list_gmail_messages_tool(workspace_id: str, max_results: int = 10, query: Optional[str] = None) -> str:
    """Lists recent Gmail messages for the workspace's connected Google account."""
    try:
        headers = await _google_headers(workspace_id)
        url = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
        params = {"maxResults": max_results}
        if query:
            params["q"] = query
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            if resp.status_code == 200:
                messages = resp.json().get("messages", [])
                if not messages:
                    return "No Gmail messages found."
                lines = ["**Recent Gmail Messages:**"]
                for msg in messages:
                    # Get message details
                    detail_resp = await client.get(
                        f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg['id']}",
                        headers=headers,
                        params={"format": "metadata", "metadataHeaders": "Subject,From,Date"},
                    )
                    if detail_resp.status_code == 200:
                        detail = detail_resp.json()
                        headers_map = {h["name"]: h["value"] for h in detail.get("payload", {}).get("headers", [])}
                        subject = headers_map.get("Subject", "No subject")
                        sender = headers_map.get("From", "Unknown")
                        lines.append(f"- **{subject}** from {sender}")
                return "\n".join(lines)
            return f"Gmail API error {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return f"Error listing Gmail messages: {e}"


async def send_gmail_message_tool(
    workspace_id: str,
    to: str,
    subject: str,
    body: str,
) -> str:
    """Sends an email via the workspace's connected Google account."""
    try:
        headers = await _google_headers(workspace_id)
        headers["Content-Type"] = "application/json"

        # Build the raw MIME message
        import base64
        message = f"From: me\nTo: {to}\nSubject: {subject}\nContent-Type: text/plain; charset=utf-8\n\n{body}"
        raw = base64.urlsafe_b64encode(message.encode("utf-8")).decode("utf-8")

        url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
        payload = {"raw": raw}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code in (200, 201):
                return f"✅ Email sent to {to} with subject '{subject}'"
            return f"Failed to send email: {resp.status_code} — {resp.text[:200]}"
    except Exception as e:
        return f"Error sending Gmail message: {e}"


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()