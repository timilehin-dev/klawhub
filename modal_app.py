import modal
import subprocess
import tempfile
import os
import json
import base64
import requests
from bs4 import BeautifulSoup

app = modal.App("klawhub-sandbox")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]",
        "requests",
        "beautifulsoup4",
        "pandas",
        "numpy",
        "matplotlib",
        "seaborn",
        "python-docx",
        "reportlab",
    )
)

# ─────────────────────────────────────────────
# Code Execution
# ─────────────────────────────────────────────

@app.function(image=image, timeout=60)
def execute_code(code: str, language: str = "python"):
    if language not in ["python", "javascript"]:
        return {"success": False, "error": f"Unsupported language: {language}"}

    try:
        ext = ".py" if language == "python" else ".js"
        cmd = ["python3"] if language == "python" else ["node"]

        with tempfile.NamedTemporaryFile(mode="w", suffix=ext, delete=False) as f:
            f.write(code)
            filepath = f.name

        result = subprocess.run(cmd + [filepath], capture_output=True, text=True, timeout=30)
        os.unlink(filepath)

        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "error": None if result.returncode == 0 else f"Exit code {result.returncode}",
        }

    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Code execution timed out (30s)"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# Web Page Reader
# ─────────────────────────────────────────────

@app.function(image=image, timeout=30)
def read_web_page(url: str):
    try:
        headers = {"User-Agent": "Klawhub/1.0 (Research Bot)"}
        resp = requests.get(url, headers=headers, timeout=15, verify=True)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove scripts, styles, nav, footer
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()

        # Extract text from main content
        text = soup.get_text(separator="\n", strip=True)

        # Clean up excessive whitespace
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        content = "\n".join(lines)

        return {
            "success": True,
            "content": content[:8000],  # Cap at 8k chars
            "title": soup.title.string if soup.title else "",
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# Document Generation
# ─────────────────────────────────────────────

@app.function(image=image, timeout=60)
def generate_document(data: dict):
    format_type = data.get("format", "pdf")
    title = data.get("title", "Document")
    sections = data.get("sections", [])

    try:
        if format_type == "docx":
            from docx import Document
            from docx.shared import Pt, Inches, RGBColor
            from docx.enum.text import WD_ALIGN_PARAGRAPH

            doc = Document()

            # Set default font
            style = doc.styles["Normal"]
            font = style.font
            font.name = "Calibri"
            font.size = Pt(11)

            # Title
            title_para = doc.add_heading(title, level=0)
            title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER

            # Sections
            for section in sections:
                if section.get("heading"):
                    doc.add_heading(section["heading"], level=1)
                if section.get("body"):
                    doc.add_paragraph(section["body"])

            filepath = f"/tmp/{_safe_filename(title)}.docx"
            doc.save(filepath)

        elif format_type == "pdf":
            from reportlab.lib.pagesizes import letter
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import inch
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

            filepath = f"/tmp/{_safe_filename(title)}.pdf"
            doc = SimpleDocTemplate(filepath, pagesize=letter, leftMargin=0.75*inch, rightMargin=0.75*inch)

            styles = getSampleStyleSheet()
            title_style = ParagraphStyle(
                "CustomTitle", parent=styles["Title"],
                fontSize=24, spaceAfter=20, alignment=1
            )
            heading_style = ParagraphStyle(
                "CustomHeading", parent=styles["Heading2"],
                fontSize=14, spaceBefore=16, spaceAfter=8
            )
            body_style = ParagraphStyle(
                "CustomBody", parent=styles["Normal"],
                fontSize=11, leading=16, spaceAfter=8
            )

            story = [Paragraph(title, title_style), Spacer(1, 20)]

            for section in sections:
                if section.get("heading"):
                    story.append(Paragraph(section["heading"], heading_style))
                if section.get("body"):
                    story.append(Paragraph(section["body"], body_style))

            doc.build(story)
        else:
            return {"success": False, "error": f"Unsupported format: {format_type}"}

        # Read file and encode
        with open(filepath, "rb") as f:
            file_b64 = base64.b64encode(f.read()).decode()

        filename = os.path.basename(filepath)

        return {
            "success": True,
            "output_file": file_b64,
            "filename": filename,
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# Data Analytics
# ─────────────────────────────────────────────

@app.function(image=image, timeout=120, memory=512)
def run_analytics(data: dict):
    code = data.get("code", "")

    if not code:
        return {"success": False, "error": "No code provided"}

    # Prepend matplotlib config to user code
    preamble = """
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import io, os, sys

plt.rcParams['figure.dpi'] = 150
plt.rcParams['savefig.bbox'] = 'tight'
plt.rcParams['font.size'] = 10
"""
    full_code = preamble + "\n" + code

    try:
        # Check if code uses plt.savefig
        has_chart = "plt.savefig" in code or "savefig" in code

        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write(full_code)
            filepath = f.name

        env = os.environ.copy()
        env["MPLBACKEND"] = "Agg"

        result = subprocess.run(
            ["python3", filepath],
            capture_output=True, text=True, timeout=60, env=env,
        )
        os.unlink(filepath)

        output_file = None
        filename = None

        # Find generated charts
        if has_chart:
            import glob
            charts = glob.glob("/tmp/*.png") + glob.glob("/tmp/chart*.png")
            if charts:
                # Use the most recently modified chart
                charts.sort(key=lambda x: os.path.getmtime(x), reverse=True)
                with open(charts[0], "rb") as f:
                    output_file = base64.b64encode(f.read()).decode()
                filename = os.path.basename(charts[0])
                # Clean up
                for c in charts:
                    try:
                        os.unlink(c)
                    except:
                        pass

        return {
            "success": result.returncode == 0,
            "stdout": result.stdout[:4000],
            "stderr": result.stderr[:2000],
            "error": None if result.returncode == 0 else f"Exit code {result.returncode}",
            "output_file": output_file,
            "filename": filename,
        }

    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Analytics timed out (60s)"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# Unified Entry Point
# ─────────────────────────────────────────────

@app.function(image=image, timeout=120)
@modal.fastapi_endpoint(method="POST")
def execute(request: dict):
    task_type = request.get("type", "code")

    if task_type == "code":
        return execute_code.remote(request["code"], request.get("language", "python"))

    elif task_type == "web_read":
        return read_web_page.remote(request["url"])

    elif task_type == "document":
        return generate_document.remote(request)

    elif task_type == "analytics":
        return run_analytics.remote(request)

    else:
        return {"success": False, "error": f"Unknown task type: {task_type}"}


def _safe_filename(name: str) -> str:
    import re
    return re.sub(r"[^a-z0-9_-]", "_", name.lower())[:50]
