import time
import hmac
import hashlib
import json
import logging
import httpx
from typing import Dict, Any, Optional
from src.config import settings

logger = logging.getLogger("klawhub.sandbox")

class SandboxClient:
    def __init__(self, function_url: Optional[str] = None, webhook_secret: Optional[str] = None):
        self.function_url = function_url or settings.modal_function_url
        self.webhook_secret = (webhook_secret or settings.modal_webhook_secret).encode('utf-8')

    def _generate_headers(self, payload_str: str) -> Dict[str, str]:
        """Generates HMAC-SHA256 signature and timestamp headers to secure sandbox execution."""
        timestamp = str(int(time.time()))
        
        # Sign payload + timestamp using HMAC SHA-256
        message = f"{payload_str}:{timestamp}".encode('utf-8')
        signature = hmac.new(self.webhook_secret, message, hashlib.sha256).hexdigest()
        
        return {
            "X-Webhook-Timestamp": timestamp,
            "X-Webhook-Signature": signature,
            "Content-Type": "application/json"
        }

    async def execute_code(
        self, 
        code: str, 
        language: str = "python", 
        timeout_seconds: int = 120,
        dependencies: Optional[list[str]] = None,
        memory_tier: Optional[str] = None,
        workspace_id: Optional[Any] = None
    ) -> Dict[str, Any]:
        """Executes a dynamic code script inside the secure, isolated Modal sandbox.
        
        Intelligently auto-detects dependencies and memory requirements based on import analysis.
        Automatically checks and mounts custom skills cached in the database for the given workspace.
        Returns a dict containing stdout, stderr, execution duration, and exit status code.
        """
        deps = list(dependencies) if dependencies else []
        tier = memory_tier or "standard"
        mounted_skills = {}

        if language == "python":
            import ast
            import sys
            
            try:
                tree = ast.parse(code)
                imported = set()
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        for name in node.names:
                            imported.add(name.name.split('.')[0])
                    elif isinstance(node, ast.ImportFrom):
                        if node.module:
                            imported.add(node.module.split('.')[0])

                # standard libraries to ignore
                stdlib = getattr(sys, "stdlib_module_names", set())

                # pre-installed packages in Modal
                pre_installed = {
                    "fastapi", "requests", "httpx", "lxml", "beautifulsoup4", "polars", "pandas",
                    "numpy", "matplotlib", "seaborn", "plotly", "scikit-learn", "typst", "pypandoc",
                    "markdown", "pdfplumber", "weasyprint", "fastembed", "crawl4ai", "lightpanda-py",
                    "playwright", "json", "math", "datetime", "time", "re", "csv", "collections", "itertools"
                }

                # heavy modules that trigger the 16GB tier
                heavy_modules = {
                    "torch", "tensorflow", "transformers", "scipy", "fastembed", "spacy", "crawl4ai",
                    "weasyprint", "playwright", "polars"
                }

                # --- Auto-Detect and Mount Custom Skills ---
                if workspace_id:
                    try:
                        import uuid
                        from sqlmodel import select
                        from src.db.pool import get_db_session
                        from src.db.models import Skill

                        normalized_workspace_id = uuid.UUID(str(workspace_id))
                        async with get_db_session() as session:
                            stmt = select(Skill).where(Skill.workspace_id == normalized_workspace_id, Skill.is_active == True)
                            db_skills = (await session.execute(stmt)).scalars().all()
                            
                            skills_map = {s.name.lower().strip(): s for s in db_skills}
                            
                            for mod in list(imported):
                                normalized_mod = mod.lower().strip()
                                if normalized_mod in skills_map:
                                    skill = skills_map[normalized_mod]
                                    logger.info(f"Auto-detect mounted skill requirement: '{normalized_mod}'")
                                    
                                    # Add to mounted skills dictionary
                                    mounted_skills[normalized_mod] = {
                                        "code": skill.source_code,
                                        "dependencies": [d.strip() for d in skill.dependencies.split(",")] if skill.dependencies else []
                                    }
                                    
                                    # If the skill itself has dynamic dependencies, append them
                                    if skill.dependencies:
                                        for dep in skill.dependencies.split(","):
                                            dep = dep.strip()
                                            if dep and dep not in deps:
                                                deps.append(dep)
                                    
                                    # If the skill or its dependencies import heavy packages, promote memory tier
                                    if skill.dependencies:
                                        for dep in skill.dependencies.split(","):
                                            dep_base = dep.split("==")[0].strip().lower()
                                            if dep_base in heavy_modules:
                                                tier = "heavy"
                                                
                                    # Exclude the skill itself from pip package installation list!
                                    if mod in imported:
                                        imported.remove(mod)
                    except Exception as skill_err:
                        logger.warning(f"Failed to auto-detect/load workspace skills from database: {skill_err}")

                for mod in imported:
                    # Upgrade memory tier if a heavy module is imported
                    if mod in heavy_modules:
                        tier = "heavy"
                    
                    # Auto-detect dynamic packages to install (not standard, not pre-installed, and not local app modules)
                    if (mod not in stdlib and 
                        mod not in pre_installed and 
                        mod not in {"src", "api", "db", "workflows"} and 
                        mod not in deps):
                        # Simple rule to avoid appending standard built-in mock modules
                        if not mod.startswith("_"):
                            deps.append(mod)

            except Exception as e:
                logger.warning(f"Failed to auto-detect dependencies or memory tier: {e}")

        payload = {
            "code": code,
            "language": language,
            "timeout": timeout_seconds,
            "dependencies": deps,
            "memory_tier": tier,
            "mounted_skills": mounted_skills
        }
        payload_str = json.dumps(payload)
        headers = self._generate_headers(payload_str)
        
        logger.info(f"Dispatching dynamic sandbox job to Modal (language: {language}, timeout: {timeout_seconds}s)")
        
        async with httpx.AsyncClient(timeout=float(timeout_seconds + 10)) as client:
            try:
                response = await client.post(
                    self.function_url,
                    content=payload_str,
                    headers=headers
                )
                
                if response.status_code != 200:
                    logger.error(f"Modal sandbox returned error HTTP status: {response.status_code}")
                    return {
                        "success": False,
                        "exit_code": -1,
                        "stdout": "",
                        "stderr": f"Sandbox execution HTTP error: {response.status_code}\nContent: {response.text}",
                        "duration_ms": 0
                    }
                
                result = response.json()
                logger.info(f"Sandbox run completed successfully with exit code: {result.get('exit_code', 0)}")
                return {
                    "success": result.get("exit_code", -1) == 0,
                    "exit_code": result.get("exit_code", -1),
                    "stdout": result.get("stdout", ""),
                    "stderr": result.get("stderr", ""),
                    "duration_ms": result.get("duration_ms", 0),
                    "error": result.get("error", None)
                }
                
            except httpx.RequestError as e:
                logger.exception("Failed to connect to Modal sandbox gateway")
                return {
                    "success": False,
                    "exit_code": -1,
                    "stdout": "",
                    "stderr": f"Network request to Sandbox failed: {str(e)}",
                    "duration_ms": 0
                }

# Global Sandbox Client instance
sandbox_client = SandboxClient()
