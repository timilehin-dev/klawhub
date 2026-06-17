"""
AES-256-GCM encryptor for KlawHub credential storage.

Encrypts Slack bot tokens, Google OAuth tokens, and GitHub app keys
before storing them in the Supabase `integrations` table.

Fix applied: removed silent null-padding fallback. A bad ENCRYPTION_KEY
now raises immediately instead of silently producing a weak key.
"""
import base64
import json
from typing import Union, Dict, Any
from src.config import settings

# Gracefully support both pycryptodome package names
try:
    from Crypto.Cipher import AES
except ImportError:
    from Cryptodome.Cipher import AES


class Encryptor:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        raw = settings.ENCRYPTION_KEY
        try:
            self.key = bytes.fromhex(raw)
            if len(self.key) != 32:
                raise ValueError(
                    f"ENCRYPTION_KEY decoded to {len(self.key)} bytes; "
                    "must be exactly 32 bytes (64 hex characters)."
                )
        except ValueError as e:
            # Raise hard — never silently degrade to a weak key
            raise ValueError(
                f"Invalid ENCRYPTION_KEY: {e}. "
                "Set a 64-character hex string (e.g. `openssl rand -hex 32`)."
            ) from e

    def encrypt(self, data: Union[str, Dict[str, Any]]) -> str:
        """
        Encrypts data using AES-256-GCM.
        Returns a base64-encoded string containing: nonce (12 B) + tag (16 B) + ciphertext.
        """
        if isinstance(data, dict):
            plaintext = json.dumps(data).encode("utf-8")
        else:
            plaintext = str(data).encode("utf-8")

        import secrets
        nonce = secrets.token_bytes(12)
        cipher = AES.new(self.key, AES.MODE_GCM, nonce=nonce)
        ciphertext, tag = cipher.encrypt_and_digest(plaintext)
        payload = cipher.nonce + tag + ciphertext
        return base64.b64encode(payload).decode("utf-8")

    def decrypt(self, encrypted_str: str) -> str:
        """Decrypts an AES-256-GCM base64 payload and returns the plaintext string."""
        payload = base64.b64decode(encrypted_str.encode("utf-8"))
        nonce = payload[:12]
        tag = payload[12:28]
        ciphertext = payload[28:]
        cipher = AES.new(self.key, AES.MODE_GCM, nonce=nonce)
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
        return plaintext.decode("utf-8")

    def decrypt_json(self, encrypted_str: str) -> Dict[str, Any]:
        """Decrypts and JSON-parses an encrypted payload."""
        return json.loads(self.decrypt(encrypted_str))


# Global instance — initialized once at import time
encryptor = Encryptor()
