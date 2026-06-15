import asyncio
import modal
from typing import Dict, Any, List, Optional
from concurrent.futures import ThreadPoolExecutor
from src.db.operations import get_skill

async def run_sandbox_function(func_name: str, *args, **kwargs) -> Any:
    """Invokes a specific sandboxed function in the Modal container asynchronously."""
    def call_modal():
        # Looks up the deployed klawhub-sandbox app function
        f = modal.Function.lookup("klawhub-sandbox", func_name)
        return f.remote(*args, **kwargs)

    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor() as pool:
        return await loop.run_in_executor(pool, call_modal)

async def run_skill_tool(slug: str, workspace_id: str, inputs: Dict[str, Any]) -> str:
    """Agent tool to execute a versioned workspace skill (built-in or dynamically generated) in the Modal sandbox."""
    try:
        skill = await get_skill(workspace_id, slug)
        if not skill:
            return f"Error: Active skill '{slug}' not found in workspace."
        
        code = skill.get("code")
        if not code:
            return f"Error: No code found for skill '{slug}'."
            
        res = await run_sandbox_function("run_python_script", code, inputs)
        return f"Skill {slug} executed successfully. Result:\n{res}"
    except Exception as e:
        return f"Error executing skill {slug} in sandbox: {str(e)}"
