"""
GitHub Skill Installer for KlawHub.

Downloads a skill from a GitHub repository, verifies it via AST scan,
and registers it in the skills catalog (pending admin approval).

Uses the shared inngest_client from `src.core.inngest_client`.
"""
import base64
import io
import zipfile
import httpx
import inngest
from src.core.inngest_client import inngest_client
from src.core.security.ast_scanner import scan_code
from src.db.operations import execute_statement


@inngest_client.create_function(
    fn_id="install-skill-from-github",
    trigger=inngest.TriggerEvent(event="skill/install"),
)
async def install_skill_from_github(ctx: inngest.Context, step: inngest.Step):
    """Downloads, verifies, and installs a custom skill from GitHub."""
    event_payload = ctx.event.data
    workspace_id = event_payload.get("workspace_id")
    github_url = event_payload.get("github_url")
    created_by = event_payload.get("created_by", "slack")

    if not github_url or "github.com" not in github_url:
        return {"status": "failed", "reason": "Invalid GitHub URL"}

    parts = github_url.rstrip("/").split("/")
    if len(parts) < 5:
        return {"status": "failed", "reason": "URL must be https://github.com/user/repo"}

    username, repo = parts[-2], parts[-1]
    zipball_url = f"https://api.github.com/repos/{username}/{repo}/zipball/main"

    # 1. Download zipball — return base64 string (JSON-serializable, not BytesIO)
    async def download_repo() -> str:
        headers = {"User-Agent": "KlawHub-Worker"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(zipball_url, headers=headers, follow_redirects=True)
            if resp.status_code != 200:
                raise RuntimeError(f"Failed to download repository: HTTP {resp.status_code}")
            # Return as base64 string so Inngest can serialize it between steps
            return base64.b64encode(resp.content).decode("utf-8")

    try:
        zip_b64 = await step.run("download-zipball", download_repo)
    except Exception as e:
        return {"status": "failed", "reason": f"Download failed: {str(e)}"}

    # 2. Extract code and configurations
    async def extract_contents() -> dict:
        zip_bytes = base64.b64decode(zip_b64)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            file_list = z.namelist()

            # Find the primary skill entry file (starts with skill_ and ends in .py)
            entry_file = None
            for f in file_list:
                basename = f.split("/")[-1]
                if basename.startswith("skill_") and basename.endswith(".py"):
                    entry_file = f
                    break

            if not entry_file:
                raise ValueError("No 'skill_*.py' entry file found in repository.")

            code = z.read(entry_file).decode("utf-8")
            requirements = ""
            documentation = ""

            for f in file_list:
                basename = f.split("/")[-1]
                if basename == "requirements.txt":
                    requirements = z.read(f).decode("utf-8")
                elif basename == "SKILL.md":
                    documentation = z.read(f).decode("utf-8")

            slug = entry_file.split("/")[-1].replace("skill_", "").replace(".py", "")
            name = slug.replace("_", " ").title()

            return {
                "name": name,
                "slug": slug,
                "code": code,
                "requirements": requirements,
                "documentation": documentation,
                "entry_file": entry_file.split("/")[-1],
            }

    try:
        extracted = await step.run("extract-zip-contents", extract_contents)
    except Exception as e:
        return {"status": "failed", "reason": f"Extraction failed: {str(e)}"}

    # 3. AST safety scan
    async def run_ast_scan() -> bool:
        is_safe, errors = scan_code(extracted["code"])
        if not is_safe:
            raise ValueError("AST validation failed: " + "; ".join(errors))
        return True

    try:
        await step.run("verify-ast-safety", run_ast_scan)
    except Exception as e:
        return {"status": "failed", "reason": f"AST Safety Error: {str(e)}"}

    # 4. Insert into catalog (pending approval)
    async def catalog_skill():
        await execute_statement(
            """
            INSERT INTO skills
              (workspace_id, name, slug, description, skill_type, entry_file, code,
               requirements, documentation, version, created_by, activation_status)
            VALUES ($1::uuid, $2, $3, $4, 'custom', $5, $6, $7, $8, $9, $10, 'pending_approval')
            ON CONFLICT (workspace_id, slug, version) DO UPDATE
              SET name          = EXCLUDED.name,
                  code          = EXCLUDED.code,
                  requirements  = EXCLUDED.requirements,
                  documentation = EXCLUDED.documentation,
                  updated_at    = NOW()
            """,
            workspace_id,
            extracted["name"],
            extracted["slug"],
            f"Installed from GitHub: {username}/{repo}",
            extracted["entry_file"],
            extracted["code"],
            extracted["requirements"],
            extracted["documentation"],
            "1.0.0",
            created_by,
        )

    await step.run("catalog-skill", catalog_skill)
    return {"status": "success", "skill_slug": extracted["slug"]}
