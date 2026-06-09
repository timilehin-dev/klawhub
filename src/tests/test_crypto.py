import pytest
import base64
import os
from src.integrations.crypto import CredentialEncryptor

@pytest.fixture
def encryptor():
    # Use a dummy key for testing
    return CredentialEncryptor("dummy_test_encryption_key_1234567890")

def test_encrypt_decrypt_happy_path(encryptor):
    plain_text = "my_secret_token_123"
    cipher_text = encryptor.encrypt(plain_text)

    # Should not be equal to plain text
    assert cipher_text != plain_text
    # Should be a string
    assert isinstance(cipher_text, str)

    # Decryption should recover the original text
    decrypted_text = encryptor.decrypt(cipher_text)
    assert decrypted_text == plain_text

def test_encrypt_empty_string(encryptor):
    assert encryptor.encrypt("") == ""

def test_decrypt_empty_string(encryptor):
    assert encryptor.decrypt("") == ""

def test_encrypt_different_nonce(encryptor):
    plain_text = "same_secret"
    cipher_text1 = encryptor.encrypt(plain_text)
    cipher_text2 = encryptor.encrypt(plain_text)

    # Due to different nonces, ciphertexts should be different
    assert cipher_text1 != cipher_text2

    # Both should decrypt to the same plain text
    assert encryptor.decrypt(cipher_text1) == plain_text
    assert encryptor.decrypt(cipher_text2) == plain_text

def test_decrypt_invalid_base64(encryptor):
    invalid_b64 = "invalid_base64_string!@#$"
    with pytest.raises(ValueError, match="Credential decryption failed: invalid or corrupted payload"):
        encryptor.decrypt(invalid_b64)

def test_decrypt_corrupted_payload(encryptor):
    plain_text = "secret"
    cipher_text = encryptor.encrypt(plain_text)

    # Decode the base64, alter it slightly, and re-encode
    raw_bytes = base64.urlsafe_b64decode(cipher_text.encode('utf-8'))
    # Flip one byte in the payload
    corrupted_bytes = bytearray(raw_bytes)
    corrupted_bytes[-1] = corrupted_bytes[-1] ^ 0xFF

    corrupted_cipher_text = base64.urlsafe_b64encode(corrupted_bytes).decode('utf-8')

    with pytest.raises(ValueError, match="Credential decryption failed: invalid or corrupted payload"):
        encryptor.decrypt(corrupted_cipher_text)

def test_decrypt_payload_too_short(encryptor):
    # Payload is shorter than the 12-byte nonce
    short_payload = os.urandom(10)
    short_cipher_text = base64.urlsafe_b64encode(short_payload).decode('utf-8')

    with pytest.raises(ValueError, match="Credential decryption failed: invalid or corrupted payload"):
        encryptor.decrypt(short_cipher_text)
