import re

PATTERNS = {
    "slack_token":    r"xox[bapr]-[0-9A-Za-z\-]{10,80}",
    "db_uri":         r"[a-z]+://[^:\s]+:[^@\s]+@[a-zA-Z0-9\-\.]+:\d+/[a-zA-Z0-9_\-\.]+",
    "private_key":    r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----[^*]+-----END (RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "stripe_live":    r"sk_live_[A-Za-z0-9\-]+",
    "github_pat":     r"ghp_[A-Za-z0-9]+",
    "aws_key":        r"AKIA[0-9A-Z]{16}",
    "generic_secret": r"(?i)(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['\"][^'\"]{16,}['\"]"
}

class DLPAuditor:
    def __init__(self):
        self.regexes = {name: re.compile(pat) for name, pat in PATTERNS.items()}

    def audit_and_redact(self, text: str) -> str:
        """Scans the text for secret patterns and replaces them with a redacted placeholder."""
        if not text:
            return text

        redacted_text = text
        for name, regex in self.regexes.items():
            if name == "generic_secret":
                # For generic secrets (e.g. API_KEY = "1234abcd..."), let's redact only the secret value, not the label
                matches = regex.finditer(redacted_text)
                for match in matches:
                    full_match = match.group(0)
                    # Split on colon or equal and preserve the label
                    parts = re.split(r'([:=])', full_match, maxsplit=1)
                    if len(parts) == 3:
                        label, op, val = parts
                        redacted_text = redacted_text.replace(full_match, f"{label}{op} [REDACTED_BY_KLAW_AUDITOR]")
            else:
                redacted_text = regex.sub("[REDACTED_BY_KLAW_AUDITOR]", redacted_text)
                
        return redacted_text

# Global auditor instance
dlp_auditor = DLPAuditor()
