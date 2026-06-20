"""
Shared utilities for KlawHub's skill installer.

Covers both Python executable skills (Modal sandbox) and
markdown instruction skills (agent guidance).
"""
import base64
import io
import zipfile
import re
import logging
from typing import Optional, Tuple, Dict, List, Any
from pathlib import Path

import httpx

from src.config import settings

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────────
MAX_REPO_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024   # 2 MB
SKILL_ENTRY_PATTERN = re.compile(r"skill_.+\.py$")
SUPPORTED_EXTENSIONS = {".py", ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".cfg", ".html", ".css", ".js", ".png", ".jpg", ".svg", ".ico"}

# ── GitHub API helpers ───────────────────────────────────────────────────────────

def _github_headers() -> Dict[str, str]:
    headers = {"User-Agent": "KlawHub-Worker"}
    if settings.GITHUB_PAT:
        headers["Authorization"] = f"token {settings.GITHUB_PAT}"
    return headers


async def _fetch_url(url: str, timeout: int = 30) -> httpx.Response:
    """Fetch a URL with common headers and timeout."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, headers=_github_headers(), follow_redirects=True)
        return resp


async def resolve_branch(owner: str, repo: str) -> str:
    """Return the default branch name, trying 'main' then 'master'."""
    for branch in ("main", "master"):
        test_url = f"https://api.github.com/repos/{owner}/{repo}/branches/{branch}"
        resp = await _fetch_url(test_url, timeout=10)
        if resp.status_code == 200:
            return branch
    # Fall back to GitHub API to detect default branch
    repo_url = f"https://api.github.com/repos/{owner}/{repo}"
    resp = await _fetch_url(repo_url, timeout=10)
    if resp.status_code == 200:
        return resp.json().get("default_branch", "main")
    raise ValueError(f"Cannot resolve branch for {owner}/{repo}")


def parse_github_url(url: str) -> Tuple[str, str, Optional[str], Optional[str]]:
    """
    Parse a GitHub URL into (owner, repo, branch, subpath).

    Supports formats:
    - https://github.com/owner/repo
    - https://github.com/owner/repo/tree/branch/path
    - https://github.com/owner/repo/blob/branch/path/to/file.md
    """
    parts = url.rstrip("/").split("/")
    if len(parts) < 5 or "github.com" not in url:
        raise ValueError(f"Invalid GitHub URL: {url}")

    owner, repo_name = parts[-2], parts[-1].replace(".git", "")
    branch = None
    subpath = None

    # Check for tree/blob URLs
    if len(parts) > 5:
        # https://github.com/owner/repo/tree/branch/... or blob/branch/...
        ref_type = parts[-4]  # "tree" or "blob"
        if ref_type in ("tree", "blob"):
            branch = parts[-3]
            subpath = "/".join(parts[5:])  # Everything after the 5th segment

    return owner, repo_name, branch, subpath


async def fetch_file_content(owner: str, repo: str, path: str, branch: str = "main") -> Optional[str]:
    """Fetch a single file from GitHub and return its content as a string."""
    url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
    resp = await _fetch_url(url, timeout=15)
    if resp.status_code == 200:
        return resp.text
    return None


async def fetch_file_content_encoded(owner: str, repo: str, path: str, branch: str = "main") -> Optional[bytes]:
    """Fetch a binary file from GitHub and return raw bytes."""
    url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
    resp = await _fetch_url(url, timeout=15)
    if resp.status_code == 200:
        return resp.content
    return None


# ── Zipball download & extraction ────────────────────────────────────────────────

async def download_zipball(owner: str, repo: str, branch: str = "main") -> bytes:
    """Download a GitHub repo zipball and return raw bytes."""
    url = f"https://api.github.com/repos/{owner}/{repo}/zipball/{branch}"
    resp = await _fetch_url(url, timeout=60)
    if resp.status_code == 200:
        if len(resp.content) > MAX_REPO_SIZE_BYTES:
            raise ValueError(f"Repository exceeds maximum size of {MAX_REPO_SIZE_BYTES // 1024 // 1024} MB")
        return resp.content
    elif resp.status_code == 404:
        raise ValueError(f"Repository {owner}/{repo} not found (branch: {branch})")
    elif resp.status_code == 403:
        raise ValueError(f"Rate limited or access denied to {owner}/{repo}. "
                         f"Use GITHUB_PAT for private repos or higher rate limits.")
    else:
        raise RuntimeError(f"Failed to download repository: HTTP {resp.status_code}")


def extract_zipball(zip_bytes: bytes) -> Dict[str, Any]:
    """
    Extract a GitHub zipball and return structured contents.

    Returns:
        {
            "files": { "relative/path": content_str_or_base64, ... },
            "entry_files": [ "relative/path/skill_foo.py", ... ],
            "skilled_files": [ "relative/path/SKILL.md", ... ],
            "requirements": "str or empty",
        }
    """
    result: Dict[str, Any] = {
        "files": {},
        "entry_files": [],
        "skilled_files": [],
        "requirements": "",
        "total_size": 0,
    }

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        # Determine the common root (GitHub zipballs have a top-level directory)
        all_names = z.namelist()
        if not all_names:
            raise ValueError("Empty zipball")

        # Find the root directory name
        root = all_names[0].split("/")[0] if "/" in all_names[0] else ""

        for f in all_names:
            # Skip directories
            if f.endswith("/"):
                continue

            # Compute relative path from the repo root
            if root and f.startswith(root + "/"):
                rel_path = f[len(root) + 1:]
            else:
                rel_path = f

            if not rel_path:
                continue

            raw = z.read(f)
            result["total_size"] += len(raw)

            # Check file size
            if len(raw) > MAX_FILE_SIZE_BYTES:
                logger.warning(f"Skipping oversized file: {rel_path} ({len(raw)} bytes)")
                continue

            # Detect if binary or text by checking extension
            is_text = _is_text_file(rel_path)
            if is_text:
                try:
                    result["files"][rel_path] = raw.decode("utf-8")
                except UnicodeDecodeError:
                    result["files"][rel_path] = base64.b64encode(raw).decode("utf-8")
            else:
                result["files"][rel_path] = base64.b64encode(raw).decode("utf-8")

            # Categorize files
            basename = rel_path.split("/")[-1]
            if SKILL_ENTRY_PATTERN.match(basename):
                result["entry_files"].append(rel_path)
            if basename == "requirements.txt":
                result["requirements"] += raw.decode("utf-8") + "\n"
            if basename == "SKILL.md":
                result["skilled_files"].append(rel_path)

    result["requirements"] = result["requirements"].strip()
    return result


# ── Detection & classification ───────────────────────────────────────────────────

SKILL_MODES = {
    "python": "python",   # Has skill_*.py → executable Modal skill
    "instruction": "instruction",  # Has SKILL.md → markdown instruction skill
    "hybrid": "hybrid",   # Has both
    "unknown": "unknown", # Neither
}


def detect_skill_mode(extracted: Dict[str, Any]) -> str:
    """Auto-detect the type of skill based on extracted contents."""
    has_entry = len(extracted.get("entry_files", [])) > 0
    has_skilled = len(extracted.get("skilled_files", [])) > 0

    if has_entry and has_skilled:
        return SKILL_MODES["hybrid"]
    elif has_entry:
        return SKILL_MODES["python"]
    elif has_skilled:
        return SKILL_MODES["instruction"]
    return SKILL_MODES["unknown"]


def sanitize_skill_name(name: str) -> str:
    """Convert a string to a safe slug for skill names."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "_", slug)
    slug = slug.strip("_")
    return slug or "untitled"


def validate_handler_signature(code: str) -> Tuple[bool, str]:
    """
    Validate that a Python skill has a proper handler function.
    Returns (is_valid, error_message).
    """
    import ast
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"Syntax error: {e}"

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "handler":
            args = node.args
            # Must have exactly 2 positional arguments: (workspace_id, inputs)
            required_args = len(args.args) - len(args.defaults)
            if required_args != 2:
                return False, (
                    f"handler() must accept exactly 2 arguments (workspace_id, inputs), "
                    f"got {required_args} required args"
                )
            return True, ""

    return False, "No 'handler' function found in skill code"


# ── Internal helpers ─────────────────────────────────────────────────────────────

def _is_text_file(path: str) -> bool:
    ext = Path(path).suffix.lower()
    return ext in {
        ".py", ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".cfg",
        ".html", ".css", ".js", ".svg", ".xml", ".ini", ".conf", ".sh",
        ".env", ".gitignore", ".dockerfile", ".sql", ".csv",
    } or ext == ""
