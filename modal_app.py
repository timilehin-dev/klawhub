import modal
import subprocess
import tempfile
import os

app = modal.App("klawhub-sandbox")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]",  # <-- ADD THIS LINE
        "requests",
        "beautifulsoup4",
        "pandas",
        "numpy",
    )
)

@app.function(image=image, timeout=60)
def execute_code(code: str, language: str = "python"):
    if language not in ["python", "javascript"]:
        return {
            "passed": False,
            "stdout": "",
            "stderr": "",
            "error": f"Unsupported language: {language}. Use 'python' or 'javascript'.",
        }

    try:
        if language == "python":
            with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
                f.write(code)
                f.flush()
                filepath = f.name

            result = subprocess.run(
                ["python3", filepath],
                capture_output=True,
                text=True,
                timeout=30,
            )
            os.unlink(filepath)

        else:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False) as f:
                f.write(code)
                f.flush()
                filepath = f.name

            result = subprocess.run(
                ["node", filepath],
                capture_output=True,
                text=True,
                timeout=30,
            )
            os.unlink(filepath)

        passed = result.returncode == 0

        return {
            "passed": passed,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "error": None if passed else f"Exit code {result.returncode}",
        }

    except subprocess.TimeoutExpired:
        return {
            "passed": False,
            "stdout": "",
            "stderr": "",
            "error": "Code execution timed out (30s limit)",
        }
    except Exception as e:
        return {
            "passed": False,
            "stdout": "",
            "stderr": "",
            "error": str(e),
        }

@app.function(image=image, timeout=60)
@modal.fastapi_endpoint(method="POST")
def run_code(data: dict):
    code = data.get("code", "")
    language = data.get("language", "python")
    return execute_code.remote(code, language)