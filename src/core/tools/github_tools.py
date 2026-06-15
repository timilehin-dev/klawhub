"""
GitHub integration tools.

Retrieves encrypted GitHub access tokens from the `integrations` table
and calls the GitHub REST API v3.

Function names match the TOOLS registry in general.py.
"""
import httpx
from typing import Optional
from src.db.operations import execute_query
from src.core.security.encryptor import encryptor


async def _get_github_token(workspace_id: str) -> str:
    """Retrieves and decrypts the GitHub access token for this workspace."""
    rows = await execute_query(
        "SELECT * FROM integrations WHERE workspace_id = $1::uuid AND provider = 'github' LIMIT 1",
        workspace_id,
    )
    if not rows:
        raise ValueError("GitHub integration not configured for this workspace.")
    encrypted_token = dict(rows[0]).get("access_token")
    if not encrypted_token:
        raise ValueError("GitHub access token missing.")
    return encryptor.decrypt(encrypted_token)


def _gh_headers(token: str) -> dict:
    return {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
    }


async def list_repos_tool(workspace_id: str) -> str:
    """Lists GitHub repositories accessible by this workspace's integration."""
    try:
        token = await _get_github_token(workspace_id)
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://api.github.com/installation/repositories",
                headers=_gh_headers(token),
                params={"per_page": 20},
            )
            if resp.status_code == 200:
                repos = resp.json().get("repositories", [])
                if not repos:
                    return "No repositories accessible."
                lines = ["**Accessible Repositories:**"]
                for r in repos:
                    lines.append(f"- **{r['full_name']}** — {r.get('description','') or 'No description'}")
                return "\n".join(lines)
            return f"GitHub API error {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return f"Error listing repos: {e}"


async def create_github_issue_tool(
    workspace_id: str,
    repo: str,
    title: str,
    body: Optional[str] = None,
) -> str:
    """Creates a new issue in a GitHub repository (format: 'owner/repo')."""
    try:
        token = await _get_github_token(workspace_id)
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"https://api.github.com/repos/{repo}/issues",
                json={"title": title, "body": body or ""},
                headers=_gh_headers(token),
            )
            if resp.status_code == 201:
                return f"✅ Issue created: {resp.json().get('html_url')}"
            return f"Failed to create issue: {resp.status_code} — {resp.text[:200]}"
    except Exception as e:
        return f"Error creating GitHub issue: {e}"


async def list_github_issues_tool(
    workspace_id: str,
    repo: str,
    state: str = "open",
) -> str:
    """Lists issues in a GitHub repository."""
    try:
        token = await _get_github_token(workspace_id)
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.github.com/repos/{repo}/issues",
                headers=_gh_headers(token),
                params={"state": state, "per_page": 20},
            )
            if resp.status_code == 200:
                issues = resp.json()
                if not issues:
                    return f"No {state} issues found in {repo}."
                lines = [f"**{state.capitalize()} Issues in `{repo}`:**"]
                for i in issues:
                    lines.append(f"- [#{i['number']}] **{i['title']}** — {i.get('html_url')}")
                return "\n".join(lines)
            return f"GitHub API error {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return f"Error listing issues: {e}"


async def create_pull_request_tool(
    workspace_id: str,
    repo: str,
    title: str,
    head: str,
    base: str,
    body: Optional[str] = None,
) -> str:
    """Creates a new pull request in a GitHub repository."""
    try:
        token = await _get_github_token(workspace_id)
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"https://api.github.com/repos/{repo}/pulls",
                json={"title": title, "head": head, "base": base, "body": body or ""},
                headers=_gh_headers(token),
            )
            if resp.status_code == 201:
                return f"✅ Pull request created: {resp.json().get('html_url')}"
            return f"Failed to create PR: {resp.status_code} — {resp.text[:200]}"
    except Exception as e:
        return f"Error creating PR: {e}"
