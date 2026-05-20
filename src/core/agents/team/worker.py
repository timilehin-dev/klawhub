import logging
from typing import Dict, Any, List
from src.core.llm.client import LLMClient

logger = logging.getLogger("klawhub.core.agents.team.worker")

# Keywords that indicate the query requires code execution in a sandbox
CODE_EXECUTION_KEYWORDS = [
    "calculate", "compute", "generate csv", "generate pdf", "scrape", "crawl",
    "analyze data", "plot", "chart", "graph", "spreadsheet", "parse", "transform",
    "download", "fetch data", "api call", "http request", "run script", "execute",
    "build", "compile", "deploy", "database", "sql", "query data", "export",
    "convert file", "process file", "extract text", "ocr", "image processing"
]


def _needs_sandbox_execution(user_query: str, milestone_desc: str) -> bool:
    """Determines if the user query or milestone requires sandbox code execution.
    
    Simple conversational queries (greetings, introductions, questions, summaries)
    should be answered directly by the LLM without sandbox execution.
    """
    combined = (user_query + " " + milestone_desc).lower()
    return any(kw in combined for kw in CODE_EXECUTION_KEYWORDS)


async def worker_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Worker Node: Handles task execution.
    
    For conversational queries: returns LLM text response directly.
    For code-execution queries: generates, validates (via AST), and executes in Modal sandbox.
    """
    user_query = state.get("user_query")
    bot_name = state.get("bot_name", "Klawhub")
    personality = state.get("bot_personality", "Professional AI worker.")
    context_data = state.get("context_data", [])
    milestones = state.get("milestones", [])
    active_index = state.get("active_milestone_index", 0)

    # If the active milestone is NOT a worker milestone, skip
    if active_index >= len(milestones) or milestones[active_index].get("assigned_to") != "worker":
        logger.info(f"Worker skipping node - active milestone is assigned to: '{milestones[active_index].get('assigned_to') if active_index < len(milestones) else 'None'}'")
        return {}

    current_milestone = milestones[active_index]
    milestone_desc = current_milestone.get("description", "")
    logger.info(f"Worker processing milestone: '{milestone_desc}'")

    # Decide execution path: direct LLM response vs sandbox code execution
    if not _needs_sandbox_execution(user_query, milestone_desc):
        # --- CONVERSATIONAL PATH: Return LLM text directly ---
        return await _handle_conversational(state, current_milestone, milestones, active_index)
    else:
        # --- CODE EXECUTION PATH: Generate code, validate, execute in sandbox ---
        return await _handle_code_execution(state, current_milestone, milestones, active_index)


async def _handle_conversational(
    state: Dict[str, Any],
    current_milestone: dict,
    milestones: list,
    active_index: int
) -> Dict[str, Any]:
    """Handles conversational queries by returning the LLM's text response directly."""
    user_query = state.get("user_query")
    bot_name = state.get("bot_name", "Klawhub")
    personality = state.get("bot_personality", "Professional AI worker.")
    context_data = state.get("context_data", [])

    system_prompt = (
        f"You are {bot_name}, a proactive AI coworker integrated into a Slack workspace.\n"
        f"Your personality is: {personality}\n\n"
        f"Respond directly to the user's message in a helpful, professional manner.\n"
        f"Keep your response concise and well-formatted for Slack (use markdown sparingly).\n"
        f"Do NOT wrap your response in code blocks. Just respond naturally.\n"
    )

    if context_data:
        system_prompt += f"\nAvailable context:\n{context_data}\n"

    llm = LLMClient()
    try:
        response = await llm.chat_completion(
            system_prompt=system_prompt,
            history=[],
            user_query=user_query,
            mode="STANDARD_CHAT"
        )

        content = response["content"].strip()
        if not content:
            content = "_No response generated._"

        logger.info("Worker completed conversational response successfully.")

        # Mark ALL milestones as completed for conversational queries
        # so the orchestrator routes directly to END
        updated_milestones = list(milestones)
        for m in updated_milestones:
            m["status"] = "completed"

        return {
            "worker_output": content,
            "milestones": updated_milestones,
            "errors": []
        }
    except Exception as e:
        logger.error(f"Worker conversational response failed: {str(e)}", exc_info=True)
        return {
            "errors": [f"Worker response error: {str(e)}"]
        }


async def _handle_code_execution(
    state: Dict[str, Any],
    current_milestone: dict,
    milestones: list,
    active_index: int
) -> Dict[str, Any]:
    """Handles queries that require code generation and sandbox execution."""
    from src.integrations.sandbox import sandbox_client
    from src.core.evolution.compiler import ASTSafetyScanner, SecurityError

    user_query = state.get("user_query")
    bot_name = state.get("bot_name", "Klawhub")
    personality = state.get("bot_personality", "Professional AI worker.")
    context_data = state.get("context_data", [])

    system_prompt = (
        f"You are the specialist Worker node for {bot_name}, a proactive AI coworker.\n"
        f"Your personality is: {personality}\n\n"
        f"Your task is to write a single, self-contained Python script to solve this milestone: '{current_milestone.get('description')}'\n"
        f"The user's query is: '{user_query}'\n"
        f"You have the following RAG database context available:\n{context_data}\n\n"
        f"Write high-quality, professional code. Enforce clean error handling. Print the final results to stdout.\n"
        f"You are limited to whitelisted utility packages (pandas, numpy, requests, csv, json, math, datetime, slack_sdk, document_generator).\n"
        f"Do NOT write 'eval()', 'exec()', or 'open()', or use forbidden modules, as they will be blocked by the safety scanner.\n\n"
        f"SPECIAL CAPABILITY: DOCUMENT GENERATION\n"
        f"The workspace has the 'document_generator' skill installed, which allows you to compile premium, high-fidelity corporate documents natively. "
        f"When you need to create a PDF, Excel sheet (XLSX), Word document (DOCX), or PowerPoint slide deck (PPTX), you MUST import and use 'document_generator'.\n"
        f"Always use the following high-fidelity APIs: \n"
        f"- PDF Generation:\n"
        f"  ```python\n"
        f"  import document_generator\n"
        f"  # Write elegant HTML5 with custom styles for the PDF body\n"
        f"  html_content = '''\n"
        f"  <html>\n"
        f"    <head>\n"
        f"      <style>\n"
        f"        body {{ font-family: 'Inter', sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }}\n"
        f"        h1 {{ color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; font-size: 28px; }}\n"
        f"        h2 {{ color: #1e293b; margin-top: 30px; font-size: 20px; }}\n"
        f"        p {{ color: #334155; font-size: 15px; }}\n"
        f"        .highlight {{ background-color: #f1f5f9; padding: 15px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 20px 0; }}\n"
        f"        ul {{ padding-left: 20px; }}\n"
        f"        li {{ margin-bottom: 8px; color: #334155; }}\n"
        f"      </style>\n"
        f"    </head>\n"
        f"    <body>\n"
        f"      <h1>Title</h1>\n"
        f"      <div class='highlight'><p>Executive summary...</p></div>\n"
        f"      <h2>Details</h2>\n"
        f"      <p>Body text...</p>\n"
        f"    </body>\n"
        f"  </html>\n"
        f"  '''\n"
        f"  document_generator.generate_pdf(html_content, 'filename.pdf')\n"
        f"  print('Generated PDF successfully')\n"
        f"  ```\n"
        f"- Spreadsheet/XLSX Generation (with multi-column headers and structured grid data):\n"
        f"  ```python\n"
        f"  import document_generator\n"
        f"  headers = ['Column 1', 'Column 2']\n"
        f"  data = [['Row 1 val 1', 'Row 1 val 2'], ['Row 2 val 1', 'Row 2 val 2']]\n"
        f"  document_generator.generate_xlsx(data, 'filename.xlsx', headers=headers)\n"
        f"  print('Generated XLSX successfully')\n"
        f"  ```\n"
        f"- Word Document/DOCX Generation:\n"
        f"  ```python\n"
        f"  import document_generator\n"
        f"  markdown_content = '# Document Title\\n\\n## Section 1\\nText body...'\n"
        f"  document_generator.generate_docx(markdown_content, 'filename.docx')\n"
        f"  print('Generated DOCX successfully')\n"
        f"  ```\n"
        f"- Slides/PPTX Generation:\n"
        f"  ```python\n"
        f"  import document_generator\n"
        f"  slides_data = [\n"
        f"      {{'title': 'Slide 1 Title', 'bullets': ['Bullet point 1', 'Bullet point 2']}},\n"
        f"      {{'title': 'Slide 2 Title', 'bullets': ['Bullet point A', 'Bullet point B']}}\n"
        f"  ]\n"
        f"  document_generator.generate_pptx(slides_data, 'filename.pptx')\n"
        f"  print('Generated PPTX successfully')\n"
        f"  ```\n"
        f"Any generated files are automatically scanned and posted to the Slack thread upon script completion! "
        f"Do NOT write any custom file upload or API logic; simply call the relevant 'document_generator' function and print a success message.\n\n"
        f"Return the code strictly wrapped in a single markdown code block: ```python ... ```"
    )

    llm = LLMClient()
    try:
        response = await llm.chat_completion(
            system_prompt=system_prompt,
            history=[],
            user_query=f"Generate the Python script to complete the active milestone: '{current_milestone.get('description')}'",
            mode="VETERAN_ENGINEERING"
        )

        content = response["content"]
        python_code = _extract_python_code(content)

        if not python_code:
            raise ValueError("Worker failed to extract clean python code block from LLM response.")

        # --- AST Static Safety Inbound Audit ---
        logger.info("Worker passing generated script to ASTSafetyScanner...")
        scanner = ASTSafetyScanner(python_code)
        # Will raise SecurityError if forbidden tokens/imports are present
        scanner.scan()
        logger.info("AST validation SUCCESS. No security risks detected.")

        # --- Sandbox Outbound Execution ---
        logger.info("Worker initiating Modal sandbox execution...")
        workspace_id = state.get("workspace_id")
        result = await sandbox_client.execute_code(python_code, language="python", workspace_id=workspace_id)

        if result.get("success"):
            stdout = result.get("stdout", "").strip()
            logger.info("Sandbox execution completed successfully.")
            
            # Mark milestone as completed
            updated_milestones = list(milestones)
            updated_milestones[active_index]["status"] = "completed"
            
            return {
                "worker_output": stdout,
                "milestones": updated_milestones,
                "errors": [],
                "generated_files": result.get("generated_files", [])
            }
        else:
            stderr = result.get("stderr", "").strip()
            logger.error(f"Sandbox execution failed: {stderr}")
            return {
                "errors": [f"Sandbox runtime error: {stderr}"]
            }

    except SecurityError as se:
        logger.critical(f"Worker security scan BLOCKED malicious generated code: {str(se)}")
        return {
            "errors": [f"AST Safety Blocked: {str(se)}"]
        }
    except Exception as e:
        logger.error(f"Worker failed to execute task: {str(e)}", exc_info=True)
        return {
            "errors": [f"Worker task exception: {str(e)}"]
        }

def _extract_python_code(text: str) -> str:
    """Safely extracts markdown python code block or returns text."""
    text = text.strip()
    if "```python" in text:
        return text.split("```python")[1].split("```")[0].strip()
    elif "```" in text:
        return text.split("```")[1].split("```")[0].strip()
    return text
