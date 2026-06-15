import json
from typing import Dict, Any, List, Tuple
from src.core.llm.client import llm_client
from src.core.security.ast_scanner import scan_code
from src.core.tools.skill_runner import run_sandbox_function
from src.db.operations import execute_statement

async def generate_skill_code(name: str, slug: str, description: str, instructions: str, requirements: str) -> Tuple[str, str]:
    """Uses Nemotron LLM to generate the Python code and SKILL.md documentation."""
    prompt = f"""
You are the KlawHub Skill Creator Engine. Generate a self-contained, clean, production-ready Python module for a new KlawHub skill.

Skill Name: {name}
Slug: {slug}
Description: {description}
Instructions & Functionality: {instructions}
Expected Pip Requirements: {requirements}

Strict Rules:
1. The code MUST expose a single entrypoint function: `def handler(workspace_id: str, inputs: dict) -> dict:`
2. Avoid standard imports that are unsafe (os, sys, subprocess, socket). Keep imports to whitelisted libraries (pandas, polars, numpy, openpyxl, matplotlib, seaborn, openpyxl, XlsxWriter, pdfplumber, pypdf, reportlab, jinja2, premailer, weasyprint, pypandoc_binary, cv2, etc.).
3. The code must handle exceptions gracefully.
4. Output should contain ONLY a valid JSON object matching the format below. Do not wrap in markdown quotes.

Response Format:
{{
  "code": "Python code here as a escaped string",
  "documentation": "# {name}\\n\\nDescription here...\\n\\n## Inputs...\\n\\n## Outputs..."
}}
"""

    messages = [{"role": "user", "content": prompt}]
    res = await llm_client.chat_completion(messages, temperature=0.2)
    content = res.get("choices", [{}])[0].get("message", {}).get("content", "")
    
    # Strip any markdown blocks if the LLM returned it wrapped in ```json
    if content.startswith("```json"):
        content = content[7:]
    if content.endswith("```"):
        content = content[:-3]
    content = content.strip()

    try:
        parsed = json.loads(content)
        return parsed["code"], parsed["documentation"]
    except Exception as e:
        raise ValueError(f"LLM failed to generate valid JSON payload: {str(e)}\nRaw Response: {content}")

async def create_skill_tool(workspace_id: str, name: str, slug: str, description: str, instructions: str, requirements: str, test_input: Dict[str, Any], created_by: str = "agent") -> str:
    """Dynamically designs, scans, sandboxes, and registers a custom agent skill."""
    try:
        # 1. Generate code & documentation via LLM
        code, documentation = await generate_skill_code(name, slug, description, instructions, requirements)
        
        # 2. AST Static Safety Scan
        is_safe, scan_errors = scan_code(code)
        if not is_safe:
            return f"Error: Generated skill code failed security scan.\nDetails:\n" + "\n".join(scan_errors)

        # 3. Sandbox test execution
        # We invoke the 'test_skill' function in Modal, which runs the handler with the test inputs
        test_results = {}
        try:
            test_res = await run_sandbox_function("test_skill", code, requirements, test_input)
            test_results = {
                "success": True,
                "output": test_res
            }
        except Exception as e:
            return f"Error: Generated skill failed sandbox test execution.\nTest Error: {str(e)}"

        # 4. Save versioned skill record to Supabase
        query = """
            INSERT INTO skills (workspace_id, name, slug, description, skill_type, entry_file, code, requirements, documentation, test_results, created_by, activation_status)
            VALUES ($1::uuid, $2, $3, $4, 'generated', $5, $6, $7, $8, $9, $10, 'pending_approval')
        """
        entry_file = f"skill_{slug}.py"
        test_results_str = json.dumps(test_results)
        
        await execute_statement(
            query,
            workspace_id,
            name,
            slug,
            description,
            entry_file,
            code,
            requirements,
            documentation,
            test_results_str,
            created_by
        )

        return (
            f"Successfully created skill '{name}' (slug: {slug})!\n"
            f"- AST Security Scan: Passed\n"
            f"- Sandbox Validation Run: Passed\n"
            f"- Status: Pending Admin Approval (Approval card dispatched)"
        )

    except Exception as e:
        return f"Error during skill creation flow: {str(e)}"
