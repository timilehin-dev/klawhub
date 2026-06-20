"""
Production-grade GitHub Skill Installer for KlawHub.

Downloads a skill from a GitHub repository, auto-detects the skill type
(Python executable vs markdown instruction), validates, and registers it.

Features:
- Dual-mode support: Python skills (Modal sandbox) + Instruction skills (markdown)
- Branch fallback: tries main → master → detected default
- Handler signature validation for Python skills
- Multi-file support with asset preservation
- Structured error taxonomy
- Size limits to prevent abuse
"""
import json
import logging
from typing import Optional, Dict, Any

import inngest

from src.config import settings
from src.core.inngest_client import inngest_client
from src.core.security.ast_scanner import scan_code
from src.core.skill_installer_utils import (
    parse_github_url,
    resolve_branch,
    download_zipball,
    extract_zipball,
    detect_skill_mode,
    SKILL_MODES,
    sanitize_skill_name,
    validate_handler_signature,
    MAX_REPO_SIZE_BYTES,
)
from src.db.operations import execute_statement

logger = logging.getLogger(__name__)


class SkillInstallError(Exception):
    """Base error for skill installation failures with structured metadata."""
    def __init__(self, message: str, error_type: str = "general", details: Optional[Dict] = None):
        self.error_type = error_type
        self.details = details or {}
        super().__init__(message)


@inngest_client.create_function(
    fn_id="install-skill-from-github",
    trigger=inngest.TriggerEvent(event="skill/install"),
)
async def install_skill_from_github(ctx: inngest.Context, step: inngest.Step):
    """
    Downloads, validates, and installs a custom skill from GitHub.

    Accepts both Python executable skills (skill_*.py) and
    markdown instruction skills (SKILL.md).

    Event payload:
    {
        "workspace_id": "uuid",
        "github_url": "https://github.com/owner/repo",
        "created_by": "slack" | "U_USERID",
        "branch": "main" (optional)
    }
    """
    event_payload = ctx.event.data
    workspace_id = event_payload.get("workspace_id")
    github_url = event_payload.get("github_url", "").strip()
    created_by = event_payload.get("created_by", "slack")
    preferred_branch = event_payload.get("branch")  # optional override

    # ── 0. Validate inputs ───────────────────────────────────────────────────
    if not workspace_id:
        return _fail("workspace_id is required", "validation")
    if not github_url:
        return _fail("github_url is required", "validation")

    try:
        owner, repo, _, _ = parse_github_url(github_url)
    except ValueError as e:
        return _fail(str(e), "validation", {"url": github_url})

    # ── 1. Resolve branch ────────────────────────────────────────────────────
    try:
        if preferred_branch:
            branch = preferred_branch
        else:
            branch = await step.run("resolve-branch", lambda: resolve_branch(owner, repo))
    except Exception as e:
        return _fail(f"Branch resolution failed: {e}", "network",
                     {"owner": owner, "repo": repo, "branch": preferred_branch})

    # ── 2. Download zipball ──────────────────────────────────────────────────
    try:
        zip_bytes = await step.run("download-zipball",
            lambda: download_zipball(owner, repo, branch))
    except SkillInstallError as e:
        return _fail(str(e), e.error_type, e.details)
    except Exception as e:
        return _fail(f"Download failed: {e}", "network",
                     {"owner": owner, "repo": repo, "branch": branch})

    # ── 3. Extract contents ──────────────────────────────────────────────────
    try:
        extracted = await step.run("extract-contents",
            lambda: extract_zipball(zip_bytes))
    except Exception as e:
        return _fail(f"Extraction failed: {e}", "extraction")

    # ── 4. Detect skill mode ─────────────────────────────────────────────────
    mode = detect_skill_mode(extracted)
    installed = []

    if mode == SKILL_MODES["unknown"]:
        return _fail(
            "Repository contains neither skill_*.py nor SKILL.md files. "
            "See https://klawhub.dev/docs/skills for format reference.",
            "validation",
            {"files_found": list(extracted["files"].keys())}
        )

    # ── 5. Process Python skills ─────────────────────────────────────────────
    if mode in (SKILL_MODES["python"], SKILL_MODES["hybrid"]):
        result = await step.run("install-python-skills",
            lambda: _install_python_skills(
                workspace_id, owner, repo, branch, extracted, created_by
            ))
        if result["status"] == "failed":
            return result
        installed.extend(result.get("installed", []))

    # ── 6. Process instruction skills ────────────────────────────────────────
    if mode in (SKILL_MODES["instruction"], SKILL_MODES["hybrid"]):
        result = await step.run("install-instruction-skills",
            lambda: _install_instruction_skills(
                workspace_id, owner, repo, branch, extracted, created_by
            ))
        if result["status"] == "failed":
            return result
        installed.extend(result.get("installed", []))

    return {
        "status": "success",
        "mode": mode,
        "installed": installed,
        "repo": f"{owner}/{repo}",
        "branch": branch,
    }


# ═══════════════════════════════════════════════════════════════════════════════════
#  Internal helpers
# ═══════════════════════════════════════════════════════════════════════════════════


async def _install_python_skills(
    workspace_id: str, owner: str, repo: str, branch: str,
    extracted: Dict[str, Any], created_by: str
) -> Dict[str, Any]:
    """
    Install Python executable skills from extracted zipball contents.
    Each skill_*.py file becomes a separate skill entry in the catalog.
    """
    installed = []
    entry_files = extracted.get("entry_files", [])
    skipped_count = 0

    if not entry_files:
        return _fail("No skill_*.py entry files found", "validation")

    for entry_path in entry_files:
        code = extracted["files"].get(entry_path, "")
        if not code:
            continue

        # Derive slug and name from the filename
        basename = entry_path.split("/")[-1]
        slug = basename.replace("skill_", "").replace(".py", "")
        name = slug.replace("_", " ").title()

        # Collect supporting files (everything in the same directory as the entry)
        entry_dir = _get_dir(entry_path)
        supporting_files = {}
        for fpath, fcontent in extracted["files"].items():
            if fpath != entry_path and _get_dir(fpath) == entry_dir:
                ext = fpath.split(".")[-1].lower() if "." in fpath else ""
                supporting_files[fpath] = {
                    "content": fcontent if _is_text_ext(ext) else fcontent,
                    "binary": not _is_text_ext(ext),
                }

        # AST safety scan
        is_safe, errors = scan_code(code)
        if not is_safe:
            logger.warning(f"AST rejection for {entry_path}: {errors}")
            skipped_count += 1
            installed.append({
                "slug": slug,
                "status": "rejected",
                "reason": f"AST validation failed: {'; '.join(errors)}",
            })
            continue

        # Handler signature validation
        sig_valid, sig_error = validate_handler_signature(code)
        if not sig_valid:
            logger.warning(f"Handler signature rejection for {entry_path}: {sig_error}")
            skipped_count += 1
            installed.append({
                "slug": slug,
                "status": "rejected",
                "reason": sig_error,
            })
            continue

        # Build documentation from SKILL.md
        documentation = ""
        for sm_path in extracted.get("skilled_files", []):
            if _get_dir(sm_path) == entry_dir:
                documentation = extracted["files"].get(sm_path, "")
                break

        # Build requirements from extracted (or from same directory)
        requirements = extracted.get("requirements", "")

        # Serialize supporting files as JSON
        supporting_json = json.dumps(supporting_files) if supporting_files else ""

        # Insert into catalog (pending approval)
        try:
            await _upsert_skill(
                workspace_id=workspace_id,
                name=name,
                slug=slug,
                description=f"Installed from GitHub: {owner}/{repo} ({branch})",
                skill_type="custom",
                entry_file=basename,
                code=code,
                requirements=requirements,
                documentation=documentation,
                supporting_files=supporting_json,
                version="1.0.0",
                created_by=created_by,
                activation_status="pending_approval",
            )
            installed.append({"slug": slug, "status": "pending_approval", "type": "python"})
        except Exception as e:
            logger.error(f"DB insert failed for {slug}: {e}")
            installed.append({
                "slug": slug,
                "status": "error",
                "reason": f"Database error: {e}",
            })

    # If all skills were rejected (AST / signature) and none installed, report failure
    if skipped_count > 0 and not any(i["status"] not in ("rejected", "error") for i in installed):
        rejected_reasons = [i.get("reason", "") for i in installed if i["status"] == "rejected"]
        return _fail(
            "; ".join(rejected_reasons) if rejected_reasons else "All skills were rejected",
            "validation",
            {"rejected": [i["slug"] for i in installed if i["status"] == "rejected"]}
        )

    return {"status": "success", "installed": installed}


async def _install_instruction_skills(
    workspace_id: str, owner: str, repo: str, branch: str,
    extracted: Dict[str, Any], created_by: str
) -> Dict[str, Any]:
    """
    Install markdown instruction skills from extracted zipball contents.
    Each SKILL.md file becomes a separate instruction skill entry.
    """
    installed = []
    skilled_files = extracted.get("skilled_files", [])

    if not skilled_files:
        return _fail("No SKILL.md files found", "validation")

    # Determine the repo root name from the skill directory structure
    for sk_path in skilled_files:
        # The path could be: skills/foo/SKILL.md or just SKILL.md
        parts = sk_path.split("/")
        basename = parts[-1]  # SKILL.md
        if len(parts) >= 3 and parts[-2] != "skills":
            # Nested: skills/productivity/task-management/SKILL.md → sub-skill
            # We'll use the parent directory as the slug
            parent_dir = parts[-2]
            grandparent = parts[-3] if len(parts) >= 3 else ""
            if grandparent == "skills":
                slug = parent_dir
                name = parent_dir.replace("_", " ").replace("-", " ").title()
            else:
                slug = f"{grandparent}_{parent_dir}" if grandparent != parent_dir else parent_dir
                name = slug.replace("_", " ").replace("-", " ").title()
        elif len(parts) >= 2:
            # Simple: skills/SKILL.md or <name>/SKILL.md
            # Use the parent directory as the slug
            parent_dir = parts[0] if len(parts) == 2 else parts[-2]
            slug = parent_dir
            name = parent_dir.replace("_", " ").replace("-", " ").title()
        else:
            # Just SKILL.md at root
            slug = repo
            name = repo.replace("-", " ").replace("_", " ").title()

        slug = sanitize_skill_name(slug)
        documentation = extracted["files"].get(sk_path, "")
        if not documentation:
            continue

        try:
            await _upsert_skill(
                workspace_id=workspace_id,
                name=name,
                slug=slug,
                description=f"Instruction skill from GitHub: {owner}/{repo} ({branch})",
                skill_type="instruction",
                entry_file=basename,
                code="",
                requirements="",
                documentation=documentation,
                supporting_files="",
                version="1.0.0",
                created_by=created_by,
                activation_status="active",  # Instruction skills auto-approved
            )
            installed.append({"slug": slug, "status": "active", "type": "instruction"})
        except Exception as e:
            logger.error(f"DB insert failed for {slug}: {e}")
            installed.append({
                "slug": slug,
                "status": "error",
                "reason": f"Database error: {e}",
            })

    return {"status": "success", "installed": installed}


# ── DB helpers ────────────────────────────────────────────────────────────────


async def _upsert_skill(
    workspace_id: str, name: str, slug: str, description: str,
    skill_type: str, entry_file: str, code: str,
    requirements: str, documentation: str,
    supporting_files: str, version: str,
    created_by: str, activation_status: str,
):
    """Insert or update a skill in the catalog."""
    await execute_statement(
        """
        INSERT INTO skills
          (workspace_id, name, slug, description, skill_type, entry_file, code,
           requirements, documentation, supporting_files, version, created_by, activation_status)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (workspace_id, slug, version) DO UPDATE
          SET name              = EXCLUDED.name,
              code              = EXCLUDED.code,
              requirements      = EXCLUDED.requirements,
              documentation     = EXCLUDED.documentation,
              supporting_files  = EXCLUDED.supporting_files,
              updated_at        = NOW()
        """,
        workspace_id, name, slug, description,
        skill_type, entry_file, code,
        requirements, documentation, supporting_files,
        version, created_by, activation_status,
    )


# ── Utility helpers ───────────────────────────────────────────────────────────


def _get_dir(path: str) -> str:
    """Return the directory part of a file path."""
    if "/" in path:
        return path.rsplit("/", 1)[0]
    return ""


def _is_text_ext(ext: str) -> bool:
    return ext in {"py", "md", "txt", "json", "yaml", "yml", "toml",
                    "cfg", "html", "css", "js", "svg", "xml", "ini",
                    "conf", "sh", "env", "sql", "csv", "gitignore"}


def _fail(reason: str, error_type: str = "general",
          details: Optional[Dict] = None) -> Dict[str, Any]:
    """Return a structured failure result."""
    return {
        "status": "failed",
        "reason": reason,
        "error_type": error_type,
        "details": details or {},
    }
