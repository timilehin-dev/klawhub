import re
import logging
from typing import Dict, Any

logger = logging.getLogger("klawhub.core.agents.team.auditor")

# Compile common credential regex patterns for security firewall audits
CREDENTIAL_PATTERNS = {
    # Allows hyphens and supports workspace tokens (xoxr-) to prevent suffix leaks
    "slack_token": re.compile(r"xox[bapr]-[0-9a-zA-Z\-]{10,80}"),
    "db_uri": re.compile(r"(postgresql|postgres|mongodb|mysql|redis|amqp|sqlite)://[^:\s]+:[^@\s]+@[^\s]+"),
    "private_key": re.compile(r"-----BEGIN (RSA |EC |dsa |openssh )?PRIVATE KEY-----[\s\S]+?-----END (RSA |EC |dsa |openssh )?PRIVATE KEY-----"),
    # Supports modern 107-char Stripe keys to avoid partial suffix leaks
    "stripe_key": re.compile(r"sk_(live|test)_[0-9a-zA-Z\-]{24,120}"),
    "github_pat": re.compile(r"ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82}"),
    # Matches temporary session access keys and adds word boundaries
    "aws_access_key": re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    # Matches AWS secrets even when they are wrapped in single or double quotes
    "aws_secret_key": re.compile(r"(?i)aws_secret_access_key\s*[:=]\s*['\"]?[0-9a-zA-Z/+=]{40}['\"]?"),
    "generic_secret": re.compile(r"(?i)(api_key|client_secret|client_id|access_token|password|auth_token|token|secret)\s*[:=]\s*['\"]?[0-9a-zA-Z\-_]{16,}['\"]?")
}

async def auditor_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Auditor Node: Outbound credentials leak firewall.
    
    Scans worker_output for high-entropy tokens, DB URIs, private keys,
    and API credentials, replacing them with a redacted placeholder.
    """
    worker_output = state.get("worker_output", "")
    if not worker_output:
        return {}

    logger.info("Auditor node scanning outbound worker output for credentials leaks.")
    
    redacted_output = worker_output
    leaks_found = []

    for name, pattern in CREDENTIAL_PATTERNS.items():
        matches = pattern.findall(redacted_output)
        if matches:
            leaks_found.append(name)
            # Replace all occurrences with [REDACTED_BY_AUDITOR]
            redacted_output = pattern.sub("[REDACTED_BY_AUDITOR]", redacted_output)

    if leaks_found:
        logger.critical(
            f"SECURITY ALERT: Auditor intercepted and redacted potential credential leaks: {leaks_found}!"
        )
        return {
            "worker_output": redacted_output,
            "auditor_alert": f"Redacted leaks: {', '.join(leaks_found)}"
        }

    logger.info("Auditor scan clean. No credential leaks detected.")
    return {}
