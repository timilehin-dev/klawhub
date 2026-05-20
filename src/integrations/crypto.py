import base64
import hashlib
import logging
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from src.config import settings

logger = logging.getLogger("klawhub.integrations.crypto")

class CredentialEncryptor:
    def __init__(self, raw_key: str):
        # We ensure a strict 32-byte key for AES-256 by hashing the raw key string using SHA-256
        self.key = hashlib.sha256(raw_key.encode('utf-8')).digest()
        self.aesgcm = AESGCM(self.key)

    def encrypt(self, plain_text: str) -> str:
        """Encrypts plain text string using AES-256-GCM.
        
        Returns a URL-safe Base64 encoded payload: base64(nonce + ciphertext_with_tag)
        """
        if not plain_text:
            return ""
        
        # Generate a cryptographically secure 12-byte nonce
        nonce = os.urandom(12)
        
        # Encrypt the string
        encrypted_bytes = self.aesgcm.encrypt(nonce, plain_text.encode('utf-8'), None)
        
        # Pack the nonce and ciphertext together
        payload = nonce + encrypted_bytes
        
        # Encode as URL-safe base64 string
        return base64.urlsafe_b64encode(payload).decode('utf-8')

    def decrypt(self, cipher_text_b64: str) -> str:
        """Decrypts a URL-safe Base64 encoded AES-256-GCM payload.
        
        Returns the original decoded plain text string.
        """
        if not cipher_text_b64:
            return ""
        
        try:
            # Decode the base64 payload
            payload = base64.urlsafe_b64decode(cipher_text_b64.encode('utf-8'))
            
            # The first 12 bytes represent the nonce
            nonce = payload[:12]
            encrypted_data = payload[12:]
            
            # Decrypt the ciphertext
            decrypted_bytes = self.aesgcm.decrypt(nonce, encrypted_data, None)
            return decrypted_bytes.decode('utf-8')
        except Exception as e:
            logger.error(f"Credential decryption failed: {str(e)}")
            raise ValueError("Credential decryption failed: invalid or corrupted payload")

# Instantiate a global encryptor utilizing the configured key
encryptor = CredentialEncryptor(settings.integration_encryption_key)

def encrypt_token(plain_text: str) -> str:
    """Helper to encrypt an integration token."""
    return encryptor.encrypt(plain_text)

def decrypt_token(cipher_text_b64: str) -> str:
    """Helper to decrypt an integration token."""
    return encryptor.decrypt(cipher_text_b64)
