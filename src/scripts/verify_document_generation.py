import os
import sys
import asyncio
import logging
import base64
from unittest.mock import AsyncMock, patch

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("verify_document_generation")

# Setup mock environment variables before importing config
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("UPSTASH_REDIS_REST_URL", "https://mock-redis.upstash.io")
os.environ.setdefault("UPSTASH_REDIS_REST_TOKEN", "mock_token")
os.environ.setdefault("SLACK_SIGNING_SECRET", "mock_slack_signing_secret")
os.environ.setdefault("SLACK_BOT_TOKEN", "xoxb-mock-bot-token")
os.environ.setdefault("MODAL_FUNCTION_URL", "https://mock-modal.run")
os.environ.setdefault("MODAL_WEBHOOK_SECRET", "mock_modal_secret")
os.environ.setdefault("INTEGRATION_ENCRYPTION_KEY", "mock_integration_encryption_key_32_bytes!!")
os.environ.setdefault("STATE_SIGNING_KEY", "test_state_signing_key_secure_12345")

from src.integrations.sandbox import SandboxClient
from src.workflows.message_handler import extract_text_from_slack_file

class MockHttpResponse:
    def __init__(self, status_code: int, json_data: dict):
        self.status_code = status_code
        self._json_data = json_data
        self.text = str(json_data)

    def json(self):
        return self._json_data

async def test_mock_document_generation():
    """Verify that SandboxClient captures and propagates generated files correctly."""
    logger.info("=" * 60)
    logger.info("TEST 1: Verifying SandboxClient captures generated files")
    logger.info("=" * 60)

    client = SandboxClient(
        function_url="https://mock-modal.run",
        webhook_secret="mock_modal_secret"
    )

    dummy_pdf_content = b"PDF-1.4 %mock pdf binary content"
    dummy_pdf_b64 = base64.b64encode(dummy_pdf_content).decode('utf-8')

    mock_response_data = {
        "success": True,
        "exit_code": 0,
        "stdout": "Successfully wrote file!",
        "stderr": "",
        "duration_ms": 150,
        "generated_files": [
            {
                "name": "report.pdf",
                "data_b64": dummy_pdf_b64,
                "size": len(dummy_pdf_content)
            }
        ]
    }

    mock_post = AsyncMock(return_value=MockHttpResponse(200, mock_response_data))

    with patch("httpx.AsyncClient.post", mock_post):
        code = "with open('report.pdf', 'wb') as f: f.write(b'dummy')"
        result = await client.execute_code(code)

        assert result["success"] is True
        assert "generated_files" in result
        assert len(result["generated_files"]) == 1
        assert result["generated_files"][0]["name"] == "report.pdf"
        assert result["generated_files"][0]["data_b64"] == dummy_pdf_b64
        logger.info("  [PASS] SandboxClient successfully captured and returned generated files.")

async def test_mock_pdf_parsing_delegation():
    """Verify that extract_text_from_slack_file delegates PDF parsing to Sandbox."""
    logger.info("=" * 60)
    logger.info("TEST 2: Verifying PDF text extraction delegation to sandbox")
    logger.info("=" * 60)

    # Mock downloading the file from Slack
    dummy_pdf_bytes = b"PDF-1.4 mock binary"
    mock_slack_download = AsyncMock(return_value=MockHttpResponse(200, {}))
    type(mock_slack_download.return_value).content = dummy_pdf_bytes

    # Mock Sandbox parse_document response
    mock_sandbox_response = {
        "success": True,
        "text": "This is the extracted high-fidelity text from the PDF.",
        "metadata": {"pages": 1}
    }

    # We will patch httpx.AsyncClient.get for Slack download and httpx.AsyncClient.post for Sandbox request
    async def dynamic_request(*args, **kwargs):
        return MockHttpResponse(200, mock_sandbox_response)

    async def mock_get(url, **kwargs):
        resp = MockHttpResponse(200, {})
        type(resp).content = dummy_pdf_bytes
        return resp

    with patch("httpx.AsyncClient.post", AsyncMock(side_effect=dynamic_request)) as mock_post:
        with patch("httpx.AsyncClient.get", AsyncMock(side_effect=mock_get)):
            file_info = {
                "url_private": "https://files.slack.com/files-pri/T123-F123/download/test.pdf",
                "name": "test.pdf",
                "mimetype": "application/pdf"
            }

            extracted_text = await extract_text_from_slack_file(file_info, "mock_slack_token")
            
            assert extracted_text == "This is the extracted high-fidelity text from the PDF."
            
            called_payload = None
            for call in mock_post.call_args_list:
                args, kwargs = call
                if "json" in kwargs:
                    called_payload = kwargs["json"]
                    break
                    
            assert called_payload is not None
            assert called_payload["type"] == "parse_document"
            assert called_payload["filename"] == "test.pdf"
            assert called_payload["file"] == base64.b64encode(dummy_pdf_bytes).decode('utf-8')
            
            logger.info("  [PASS] PDF text extraction successfully delegated to Sandbox parse_document.")

async def test_live_document_generation():
    """Optional live E2E check hitting the real Modal Sandbox if configured."""
    from src.config import settings
    
    url = settings.modal_function_url
    secret = settings.modal_webhook_secret
    
    if not url or "mock" in url or not secret or "mock" in secret:
        logger.info("=" * 60)
        logger.info("TEST 3: Live Sandbox E2E Check (SKIPPED - MOCK ENV)")
        logger.info("=" * 60)
        logger.info("  [INFO] Real Modal credentials not configured in environment. Skipping live integration check.")
        return

    logger.info("=" * 60)
    logger.info("TEST 3: Live Sandbox E2E Document Generation Check")
    logger.info("=" * 60)
    logger.info(f"Connecting to real Sandbox URL: {url}")

    client = SandboxClient(function_url=url, webhook_secret=secret)

    code = """
import os
import weasyprint

html_content = '''
<html>
<head>
<style>
body { font-family: sans-serif; margin: 2em; color: #333; }
h1 { color: #1a73e8; border-bottom: 1px solid #ccc; padding-bottom: 0.5em; }
p { font-size: 14px; line-height: 1.6; }
</style>
</head>
<body>
<h1>Klawhub E2E Verification Report</h1>
<p>This PDF document was successfully generated inside the isolated Modal Sandbox container using WeasyPrint.</p>
<p>Timestamp: 2026-05-20</p>
</body>
</html>
'''

# Write generated PDF to workspace
weasyprint.HTML(string=html_content).write_pdf('e2e_report.pdf')
print("Successfully generated E2E PDF!")
"""

    result = await client.execute_code(code, language="python")
    
    if not result["success"]:
        logger.error(f"  [FAIL] Live sandbox execution failed! Stderr: {result['stderr']}")
        assert False, "Live sandbox execution failed"
        
    assert "generated_files" in result
    files = result["generated_files"]
    
    report_file = next((f for f in files if f["name"] == "e2e_report.pdf"), None)
    assert report_file is not None, "e2e_report.pdf was not returned in generated_files"
    assert len(report_file["data_b64"]) > 0, "Base64 data is empty"
    logger.info(f"  [PASS] Real Sandbox returned generated file: {report_file['name']} ({report_file['size']} bytes)")

    logger.info("=" * 60)
    logger.info("TEST 4: Live Sandbox E2E PDF Parsing Check")
    logger.info("=" * 60)

    payload = {
        "type": "parse_document",
        "file": report_file["data_b64"],
        "filename": "e2e_report.pdf"
    }

    import httpx
    headers = {
        "X-Webhook-Secret": secret,
        "Content-Type": "application/json"
    }
    
    async with httpx.AsyncClient(timeout=60.0) as http_client:
        resp = await http_client.post(url, json=payload, headers=headers)
        
    assert resp.status_code == 200, f"HTTP error: {resp.status_code}"
    res_json = resp.json()
    assert res_json.get("success") is True, f"Parsing failed: {res_json}"
    extracted_text = res_json.get("text", "")
    logger.info(f"DEBUG: extracted_text is: {repr(extracted_text)}")
    
    assert "Klawhub E2E Verification" in extracted_text, f"Verification text not found in parsed output. Got: {repr(extracted_text)}"
    assert "WeasyPrint" in extracted_text, "Verification text not found in parsed output"
    
    logger.info("  [PASS] Live Sandbox successfully parsed the generated PDF and returned correct text.")

async def main():
    try:
        await test_mock_document_generation()
        await test_mock_pdf_parsing_delegation()
        await test_live_document_generation()
        logger.info("=" * 60)
        logger.info("[ALL TESTS PASSED] verify_document_generation.py completed successfully!")
        logger.info("=" * 60)
        sys.exit(0)
    except Exception as e:
        logger.error(f"[TESTS FAILED] Verification suite failed: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
