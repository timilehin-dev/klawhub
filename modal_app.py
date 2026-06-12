import modal
import subprocess
import tempfile
import os

import sys
try:
    import resource
except ImportError:
    resource = None
import base64
import glob
import hmac
import hashlib
import time
import asyncio
import re
from typing import Optional
from fastapi import Request, HTTPException

app = modal.App("klawhub-sandbox")

# ── Persistent Cache ──
# Caches pip downloads across ALL sandbox executions
pip_cache = modal.Volume.from_name("klawhub-pip-cache", create_if_missing=True)

# ── Secrets ──
try:
    webhook_secret = modal.Secret.from_name("klawhub-webhook-secret")
except Exception:
    webhook_secret = modal.Secret.from_dict({"MODAL_WEBHOOK_SECRET": ""})

# ── Image Definition ──
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "nodejs", "npm",            # JavaScript execution & dependencies
        "pandoc",                   # Professional DOCX/PDF generation
        "libpango-1.0-0",           # Weasyprint dependencies
        "libpangoft2-1.0-0",
        "libharfbuzz-subset0",
        "libjpeg-dev", "libopenjp2-7-dev", "libffi-dev",
        "curl", "ca-certificates",  # For downloading binaries
        "fonts-noto-color-emoji"    # For better document rendering
    )
    .pip_install(
        "fastapi[standard]",
        "requests",
        "httpx",                    # Better async HTTP
        "lxml",                     # Fastest raw HTML parsing
        "beautifulsoup4",
        "polars",                   # Modern, fast alternative to Pandas
        "pandas",
        "numpy",
        "matplotlib",
        "seaborn",
        "plotly",                   # Interactive charts
        "scikit-learn",             # Modern ML
        "typst",                    # Novel, professional PDF generation
        "pypandoc",                 # Pandoc wrapper for DOCX
        "markdown",                 # For converting text to HTML
        "pdfplumber",
        "weasyprint",               # Best-in-class HTML-to-PDF
        "fastembed",
        "crawl4ai",                 # LLM-ready web crawling
        "lightpanda-py",            # Lightpanda headless browser
        "playwright"                # CDP interaction with Lightpanda
    )
    .run_commands(
        "python -m playwright install chromium", # Pre-install browser for crawl4ai
        "python -c 'from fastembed import TextEmbedding; TextEmbedding()'"
    )
)

# Optimization: Skip pip if these are requested
PRE_INSTALLED_PACKAGES = {
    "fastapi", "requests", "httpx", "lxml", "beautifulsoup4", "polars", "pandas",
    "numpy", "matplotlib", "seaborn", "plotly", "scikit-learn", "typst", "pypandoc",
    "markdown", "pdfplumber", "weasyprint", "fastembed", "crawl4ai", "lightpanda-py",
    "playwright"
}

# ── Global Model Singletons ──
# Instantiated once per container life to avoid re-loading latency
_embedding_model = None

def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        from fastembed import TextEmbedding
        _embedding_model = TextEmbedding()
    return _embedding_model

# ─────────────────────────────────────────────
# Auth Middleware
# ─────────────────────────────────────────────

def verify_request(request: Request, body: bytes, max_age_seconds: int = 300) -> bool:
    """Verify requests with timestamped HMAC, preserving legacy secret fallback."""
    expected = os.environ.get("MODAL_WEBHOOK_SECRET")
    provided_secret = request.headers.get("X-Webhook-Secret", "")
    timestamp = request.headers.get("X-Webhook-Timestamp", "")
    provided_signature = request.headers.get("X-Webhook-Signature", "")

    if not expected:
        # CRITICAL: Secret MUST be configured in production
        print("WARNING: MODAL_WEBHOOK_SECRET is not configured. Denying all requests.")
        return False

    # Prefer and enforce the replay-safe HMAC path whenever HMAC headers are sent.
    if timestamp or provided_signature:
        if not timestamp or not provided_signature:
            return False
        try:
            timestamp_int = int(timestamp)
        except ValueError:
            return False
        if abs(int(time.time()) - timestamp_int) > max_age_seconds:
            return False

        message = body + f":{timestamp}".encode("utf-8")
        expected_signature = hmac.new(
            expected.encode("utf-8"),
            message,
            hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(provided_signature, expected_signature)

    # Backward compatibility for older clients that only send X-Webhook-Secret.
    if not provided_secret:
        return False

    return hmac.compare_digest(provided_secret, expected)

# ─────────────────────────────────────────────
# Code Execution (with Dynamic Dependencies)
# ─────────────────────────────────────────────

def _is_valid_package_name(dep: str, language: str = "python") -> bool:
    if not dep or dep.startswith("-"):
        return False
    if language == "python":
        return bool(re.match(r"^[a-zA-Z0-9_.\-=><~\[\],]+$", dep))
    else:
        return bool(re.match(r"^[a-zA-Z0-9_.\-@/^:]+$", dep))

def _execute_code_impl(code: str, language: str = "python", dependencies: Optional[list[str]] = None, max_memory_mb: int = 4096, mounted_skills: Optional[dict] = None, timeout_seconds: int = 120):
    if language not in ["python", "javascript"]:
        return {
            "success": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Unsupported language: {language}",
            "error": f"Unsupported language: {language}",
            "duration_ms": 0,
            "generated_files": []
        }

    dependencies = dependencies or []
    timeout_seconds = max(1, min(int(timeout_seconds or 120), 600))
    start_time = time.monotonic()

    # Use a strictly isolated temporary directory for the execution
    with tempfile.TemporaryDirectory() as env_dir:
        try:
            env = os.environ.copy()
            cmd = []
            filepath = os.path.join(env_dir, f"script.{'py' if language == 'python' else 'js'}")
            
            # Mount custom dynamic skills BEFORE dependencies check
            if mounted_skills and language == "python":
                for skill_name, skill_data in mounted_skills.items():
                    skill_filepath = os.path.join(env_dir, f"{skill_name}.py")
                    with open(skill_filepath, "w") as sf:
                        sf.write(skill_data.get("code", ""))
                    
                    # Merge dynamic dependencies
                    skill_deps = skill_data.get("dependencies", [])
                    for dep in skill_deps:
                        if dep and dep not in dependencies:
                            dependencies.append(dep)

            with open(filepath, "w") as f:
                f.write(code)

            if language == "python":
                if dependencies:
                    # Validate all dependencies
                    to_install = []
                    for d in dependencies:
                        if not _is_valid_package_name(d, "python"):
                            return {
                                "success": False,
                                "exit_code": -1,
                                "stdout": "",
                                "stderr": f"Invalid or potentially malicious dependency name: {d}",
                                "error": "Invalid dependency name",
                                "duration_ms": int((time.monotonic() - start_time) * 1000),
                                "generated_files": []
                            }
                        if d.split("==")[0].lower() not in PRE_INSTALLED_PACKAGES:
                            to_install.append(d)
                    
                    user_base = os.path.join(env_dir, "user_packages")
                    os.makedirs(user_base, exist_ok=True)
                    env["PYTHONUSERBASE"] = user_base
                    
                    if to_install:
                        install_env = env.copy()
                        try:
                            # 3-minute timeout for dependency installation
                            pip_result = subprocess.run(
                                ["python3", "-m", "pip", "install", "--user", "--no-warn-script-location"] + to_install,
                                capture_output=True, timeout=180, env=install_env
                            )
                            if pip_result.returncode != 0:
                                pip_stderr = pip_result.stderr.decode('utf-8', errors='replace')
                                return {
                                    "success": False,
                                    "exit_code": -1,
                                    "stdout": "",
                                    "stderr": f"Failed to install Python dependencies:\n{pip_stderr[:2000]}",
                                    "error": "Failed to install Python dependencies",
                                    "duration_ms": int((time.monotonic() - start_time) * 1000),
                                    "generated_files": []
                                }
                        except subprocess.TimeoutExpired:
                            return {
                                "success": False,
                                "exit_code": -1,
                                "stdout": "",
                                "stderr": "Python dependency installation timed out after 180s.",
                                "error": "Python dependency installation timed out after 180s.",
                                "duration_ms": int((time.monotonic() - start_time) * 1000),
                                "generated_files": []
                            }
                    
                    # Add the user site-packages to PYTHONPATH (even if nothing new was installed, for isolation)
                    user_site = os.path.join(user_base, "lib", f"python{sys.version_info.major}.{sys.version_info.minor}", "site-packages")
                    env["PYTHONPATH"] = f"{user_site}:{env.get('PYTHONPATH', '')}"
                
                cmd = ["python3", filepath]

            elif language == "javascript":
                if dependencies:
                    for d in dependencies:
                        if not _is_valid_package_name(d, "javascript"):
                            return {
                                "success": False,
                                "exit_code": -1,
                                "stdout": "",
                                "stderr": f"Invalid or potentially malicious dependency name: {d}",
                                "error": "Invalid dependency name",
                                "duration_ms": int((time.monotonic() - start_time) * 1000),
                                "generated_files": []
                            }
                    try:
                        subprocess.run(["npm", "init", "-y"], cwd=env_dir, check=True, capture_output=True, timeout=30)
                        subprocess.run(["npm", "install"] + dependencies, cwd=env_dir, check=True, capture_output=True, timeout=180)
                    except subprocess.CalledProcessError as e:
                        npm_stderr = e.stderr.decode('utf-8', errors='replace') if e.stderr else str(e)
                        return {
                            "success": False,
                            "exit_code": -1,
                            "stdout": "",
                            "stderr": f"Failed to install NPM dependencies:\n{npm_stderr}",
                            "error": "Failed to install NPM dependencies",
                            "duration_ms": int((time.monotonic() - start_time) * 1000),
                            "generated_files": []
                        }
                    except subprocess.TimeoutExpired:
                        return {
                            "success": False,
                            "exit_code": -1,
                            "stdout": "",
                            "stderr": "NPM dependency installation timed out after 180s.",
                            "error": "NPM dependency installation timed out after 180s.",
                            "duration_ms": int((time.monotonic() - start_time) * 1000),
                            "generated_files": []
                        }
                
                cmd = ["node", filepath]

            def set_resource_limits():
                if resource is None:
                    return
                # Limit memory dynamically to max_memory_mb
                try:
                    resource.setrlimit(resource.RLIMIT_AS, (max_memory_mb * 1024 * 1024, max_memory_mb * 1024 * 1024))
                except ValueError:
                    pass
                # Limit CPU to the requested execution timeout.
                try:
                    resource.setrlimit(resource.RLIMIT_CPU, (timeout_seconds, timeout_seconds))
                except ValueError:
                    pass

            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout_seconds,
                cwd=env_dir,
                env=env,
                preexec_fn=set_resource_limits
            )
            # Crawl for newly generated files inside the isolated execution directory
            generated_files = []
            excluded_names = {"script.py", "script.js"}
            if mounted_skills:
                for skill_name in mounted_skills.keys():
                    excluded_names.add(f"{skill_name}.py")
            
            for root, dirs, files in os.walk(env_dir):
                # Safely ignore dependencies and package manager directories to avoid heavy/invalid file captures
                if any(pkg_dir in root for pkg_dir in ["user_packages", "node_modules", ".git"]):
                    continue
                for file in files:
                    if file in excluded_names:
                        continue
                    file_path = os.path.join(root, file)
                    if not os.path.isfile(file_path):
                        continue
                    try:
                        file_size = os.path.getsize(file_path)
                        # Set a safe limit of 20MB per file to avoid webhook payloads bloating
                        if file_size > 20 * 1024 * 1024:
                            continue
                        with open(file_path, "rb") as f:
                            file_data = f.read()
                        
                        rel_path = os.path.relpath(file_path, env_dir)
                        generated_files.append({
                            "name": rel_path,
                            "data_b64": base64.b64encode(file_data).decode('utf-8'),
                            "size": file_size
                        })
                    except Exception as e:
                        print(f"Error reading generated file {file_path} inside sandbox: {e}")

            return {
                "success": result.returncode == 0,
                "exit_code": result.returncode,
                "stdout": result.stdout.decode('utf-8', errors='replace')[:10000],
                "stderr": result.stderr.decode('utf-8', errors='replace')[:5000],
                "error": None if result.returncode == 0 else f"Exit code {result.returncode}",
                "duration_ms": int((time.monotonic() - start_time) * 1000),
                "generated_files": generated_files
            }

        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Code execution timed out ({timeout_seconds}s)",
                "error": f"Code execution timed out ({timeout_seconds}s)",
                "duration_ms": int((time.monotonic() - start_time) * 1000),
                "generated_files": []
            }
        except Exception as e:
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": str(e),
                "error": str(e),
                "duration_ms": int((time.monotonic() - start_time) * 1000),
                "generated_files": []
            }

@app.function(image=image, timeout=600, memory=4096, volumes={"/root/.pip_cache": pip_cache})
def execute_code(code: str, language: str = "python", dependencies: Optional[list[str]] = None, mounted_skills: Optional[dict] = None, timeout_seconds: int = 120):
    return _execute_code_impl(code, language, dependencies, max_memory_mb=3584, mounted_skills=mounted_skills, timeout_seconds=timeout_seconds)

@app.function(image=image, timeout=600, memory=16384, volumes={"/root/.pip_cache": pip_cache})
def execute_code_heavy(code: str, language: str = "python", dependencies: Optional[list[str]] = None, mounted_skills: Optional[dict] = None, timeout_seconds: int = 120):
    return _execute_code_impl(code, language, dependencies, max_memory_mb=14336, mounted_skills=mounted_skills, timeout_seconds=timeout_seconds)

# ─────────────────────────────────────────────
# Web Page Reader (using Lightpanda)
# ─────────────────────────────────────────────

@app.function(image=image, timeout=90)
def read_web_page(url: str, engine: str = "lightpanda"):
    if engine == "crawl4ai":
        try:
            from crawl4ai import AsyncWebCrawler
            import asyncio
            
            async def crawl():
                async with AsyncWebCrawler() as crawler:
                    result = await crawler.arun(url=url)
                    return result.markdown
            
            content = asyncio.run(crawl())
            return {
                "success": True,
                "content": content[:10000],
                "title": url.split("//")[-1].split("/")[0],
            }
        except Exception as e:
            return {"success": False, "error": f"Crawl4AI failed: {str(e)}"}

    import lightpanda
    try:
        # Lightpanda natively supports dumping LLM-ready Markdown
        res = lightpanda.fetch(
            url, 
            dump="markdown", 
            wait_until="domcontentloaded", 
            strip_mode="full", 
            wait_ms=1000 
        )
        content = res.text[:10000]
        title = url.split("//")[-1].split("/")[0] # Fallback title
        
        # If the markdown has a prominent # Title, try to extract it
        for line in content.splitlines()[:10]:
            if line.startswith("# "):
                title = line[2:].strip()
                break

        return {
            "success": True,
            "content": content,
            "title": title,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

# ─────────────────────────────────────────────
# Professional Document Generation (Pandoc / WeasyPrint)
# ─────────────────────────────────────────────

@app.function(image=image, timeout=120)
def generate_document(data: dict):
    format_type = data.get("format", "pdf")
    title = data.get("title", "Document")
    markdown_content = data.get("markdown", "")
    
    # If using sections, convert to markdown first
    sections = data.get("sections", [])
    if sections and not markdown_content:
        md_parts = [f"# {title}\n"]
        for section in sections:
            if section.get("heading"):
                md_parts.append(f"## {section['heading']}\n")
            if section.get("body"):
                md_parts.append(f"{section['body']}\n")
        markdown_content = "\n".join(md_parts)

    filepath = f"/tmp/{_safe_filename(title)}_{int(time.time())}.{format_type}"

    try:
        if format_type == "docx":
            import pypandoc
            # Pandoc natively converts markdown tables, formatting, and charts to Word excellently
            pypandoc.convert_text(markdown_content, 'docx', format='md', outputfile=filepath)

        elif format_type == "pdf":
            import markdown
            from weasyprint import HTML, CSS
            
            html_body = markdown.markdown(markdown_content, extensions=['tables', 'fenced_code', 'toc'])
            
            # Professional, modern corporate CSS for WeasyPrint
            css_style = """
            @page {
                size: A4;
                margin: 2cm;
                @bottom-right { content: counter(page) " of " counter(pages); font-family: system-ui, sans-serif; font-size: 9pt; color: #666; }
                @top-left { content: string(doctitle); font-family: system-ui, sans-serif; font-size: 9pt; color: #666; }
            }
            body { font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #333; }
            h1 { color: #1a1a1a; font-size: 24pt; border-bottom: 2px solid #eaeaea; padding-bottom: 8px; string-set: doctitle content(); page-break-after: avoid; }
            h2 { color: #2c3e50; font-size: 18pt; margin-top: 1.5em; page-break-after: avoid; }
            h3 { color: #34495e; font-size: 14pt; margin-top: 1.2em; page-break-after: avoid; }
            p { margin-bottom: 1em; text-align: justify; }
            table { width: 100%; border-collapse: collapse; margin: 1.5em 0; page-break-inside: avoid; font-size: 10pt; }
            th { background-color: #f8f9fa; color: #2c3e50; font-weight: bold; text-align: left; padding: 12px; border-bottom: 2px solid #dee2e6; }
            td { padding: 10px 12px; border-bottom: 1px solid #e9ecef; }
            tr:nth-child(even) { background-color: #fcfcfc; }
            pre, code { font-family: "Cascadia Code", "Consolas", monospace; background: #f4f4f4; padding: 2px 4px; border-radius: 4px; font-size: 9pt; }
            pre { padding: 1em; overflow-x: auto; page-break-inside: avoid; border-left: 4px solid #3498db; }
            blockquote { border-left: 4px solid #ccc; margin: 1.5em 10px; padding: 0.5em 10px; color: #666; font-style: italic; }
            """
            
            full_html = f"<html><head><style>{css_style}</style></head><body>{html_body}</body></html>"
            
            HTML(string=full_html).write_pdf(filepath, stylesheets=[CSS(string=css_style)])

        else:
            return {"success": False, "error": f"Unsupported format: {format_type}"}

        with open(filepath, "rb") as f:
            file_b64 = base64.b64encode(f.read()).decode()

        try:
            os.unlink(filepath)
        except OSError:
            pass

        return {
            "success": True,
            "output_file": file_b64,
            "filename": os.path.basename(filepath),
        }

    except Exception as e:
        return {"success": False, "error": str(e)}

# ─────────────────────────────────────────────
# Data Analytics
# ─────────────────────────────────────────────

@app.function(image=image, timeout=120, memory=4096, volumes={"/root/.cache": pip_cache}, secrets=[webhook_secret])
def run_analytics(data: dict):
    code = data.get("code", "")
    dependencies = data.get("dependencies", [])

    if not code:
        return {"success": False, "error": "No code provided"}

    preamble = """
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import polars as pl
import seaborn as sns
import io, os, sys, time

plt.rcParams['figure.dpi'] = 150
plt.rcParams['savefig.bbox'] = 'tight'
plt.rcParams['font.size'] = 10
sns.set_theme(style="whitegrid")
"""
    full_code = preamble + "\n" + code

    # Isolate chart generation per request to prevent race conditions
    with tempfile.TemporaryDirectory() as env_dir:
        try:
            filepath = os.path.join(env_dir, "analytics.py")
            with open(filepath, "w") as f:
                f.write(full_code)

            env = os.environ.copy()
            env["MPLBACKEND"] = "Agg"

            if dependencies:
                # Validate all dependencies
                to_install = []
                for d in dependencies:
                    if not _is_valid_package_name(d, "python"):
                        return {"success": False, "error": f"Invalid or potentially malicious dependency name: {d}"}
                    if d.split("==")[0].lower() not in PRE_INSTALLED_PACKAGES:
                        to_install.append(d)

                if to_install:
                    user_base = os.path.join(env_dir, "user_packages")
                    os.makedirs(user_base, exist_ok=True)
                    env["PYTHONUSERBASE"] = user_base
                    try:
                        pip_result = subprocess.run(
                            ["python3", "-m", "pip", "install", "--user", "--no-warn-script-location"] + to_install,
                            capture_output=True, timeout=120, env=env
                        )
                        if pip_result.returncode != 0:
                            return {"success": False, "error": f"Failed to install: {pip_result.stderr.decode('utf-8', errors='replace')[:1000]}"}
                    except subprocess.TimeoutExpired:
                        return {"success": False, "error": "Dependency install timed out (120s)"}

                    user_site = os.path.join(user_base, "lib", f"python{sys.version_info.major}.{sys.version_info.minor}", "site-packages")
                    env["PYTHONPATH"] = f"{user_site}:{env.get('PYTHONPATH', '')}"

            result = subprocess.run(
                ["python3", filepath],
                capture_output=True, text=True, timeout=90, cwd=env_dir, env=env,
            )

            output_file = None
            filename = None

            # Look for generated charts ONLY in this isolated directory
            charts = glob.glob(os.path.join(env_dir, "*.png"))
            if charts:
                charts.sort(key=os.path.getmtime, reverse=True)
                with open(charts[0], "rb") as f:
                    output_file = base64.b64encode(f.read()).decode()
                filename = os.path.basename(charts[0])

            return {
                "success": result.returncode == 0,
                "stdout": result.stdout[:10000],
                "stderr": result.stderr[:5000],
                "error": None if result.returncode == 0 else f"Exit code {result.returncode}",
                "output_file": output_file,
                "filename": filename,
            }

        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Analytics timed out (90s)"}
        except Exception as e:
            return {"success": False, "error": str(e)}

# ─────────────────────────────────────────────
# Document Parsing and OCR Extraction
# ─────────────────────────────────────────────

@app.function(image=image, timeout=60)
def parse_document(file_b64: str, filename: str):
    file_bytes = base64.b64decode(file_b64)
    ext = os.path.splitext(filename)[1].lower()
    
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
            f.write(file_bytes)
            temp_path = f.name
            
        text_content = ""
        metadata = {}
        
        if ext == ".pdf":
            import pdfplumber
            with pdfplumber.open(temp_path) as pdf:
                pages_text = []
                for i, page in enumerate(pdf.pages):
                    page_text = page.extract_text() or ""
                    tables = page.extract_tables()
                    if tables:
                        table_str = "\n--- Structured Table Data ---\n"
                        for row in tables:
                            table_str += " | ".join([str(cell or "").strip() for cell in row]) + "\n"
                        page_text += table_str
                    pages_text.append(f"--- Page {i+1} ---\n{page_text}")
                text_content = "\n\n".join(pages_text)
                metadata = {"pages": len(pdf.pages)}
        elif ext == ".docx":
            import pypandoc
            text_content = pypandoc.convert_file(temp_path, 'plain')
        else:
            text_content = file_bytes.decode("utf-8", errors="replace")
            
        try:
            os.unlink(temp_path)
        except OSError:
            pass
            
        return {
            "success": True,
            "text": text_content,
            "metadata": metadata
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to parse document: {str(e)}"
        }

@app.function(image=image, timeout=30, secrets=[webhook_secret])
def generate_embedding(text: str) -> dict:
    try:
        model = get_embedding_model()
        embeddings = list(model.embed([text]))
        if embeddings:
            return {"success": True, "embedding": embeddings[0].tolist()}
        return {"success": False, "error": "No embeddings returned"}
    except Exception as e:
        return {"success": False, "error": f"Embedding generation failed: {str(e)}"}

# ─────────────────────────────────────────────
# Unified Entry Point
# ─────────────────────────────────────────────

@app.function(image=image, timeout=600, secrets=[webhook_secret])
@modal.fastapi_endpoint(method="POST")
async def execute(request: Request):
    body = await request.body()
    if not verify_request(request, body):
        raise HTTPException(status_code=401, detail="Invalid or missing webhook signature")

    payload = await request.json()
    task_type = payload.get("type", "code")

    if task_type == "code":
        memory_tier = payload.get("memory_tier", "standard")
        deps = payload.get("dependencies", [])
        mounted_skills = payload.get("mounted_skills", {})
        timeout_seconds = payload.get("timeout", payload.get("timeout_seconds", 120))
        
        # Auto-promote to heavy if any heavy packages are requested
        heavy_packages = {"torch", "tensorflow", "transformers", "scipy", "fastembed", "spacy", "crawl4ai", "weasyprint", "playwright", "polars"}
        if any(d.split("==")[0].strip().lower() in heavy_packages for d in deps):
            memory_tier = "heavy"
            
        if memory_tier == "heavy":
            return await execute_code_heavy.remote.aio(
                payload["code"],
                payload.get("language", "python"),
                deps,
                mounted_skills,
                timeout_seconds
            )
        else:
            return await execute_code.remote.aio(
                payload["code"],
                payload.get("language", "python"),
                deps,
                mounted_skills,
                timeout_seconds
            )
    elif task_type == "web_read":
        return await read_web_page.remote.aio(payload["url"], payload.get("engine", "lightpanda"))
    elif task_type == "document":
        return await generate_document.remote.aio(payload)
    elif task_type == "analytics":
        return await run_analytics.remote.aio(payload)
    elif task_type == "parse_document":
        return await parse_document.remote.aio(payload["file"], payload["filename"])
    elif task_type == "generate_embedding":
        return await generate_embedding.remote.aio(payload["text"])
    else:
        return {"success": False, "error": f"Unknown task type: {task_type}"}

def _safe_filename(name: str) -> str:
    import re
    return re.sub(r"[^a-z0-9_-]", "_", name.lower())[:50]
