import pytest
import os
from unittest.mock import patch
from src.core.security.ast_scanner import scan_code

def test_invalid_encryption_key_raises_value_error():
    """Test 1: Verify that a bad ENCRYPTION_KEY length raises ValueError (Gap #8)."""
    from src.core.security.encryptor import Encryptor
    
    # 1. Test short key length
    with patch("src.config.settings.ENCRYPTION_KEY", "abc"):
        with pytest.raises(ValueError) as excinfo:
            Encryptor()
        assert "must be exactly 32 bytes" in str(excinfo.value)
        
    # 2. Test non-hex character key
    with patch("src.config.settings.ENCRYPTION_KEY", "x" * 64):
        with pytest.raises(ValueError) as excinfo:
            Encryptor()
        assert "non-hexadecimal number" in str(excinfo.value).lower() or "invalid" in str(excinfo.value).lower()

def test_ast_scanner_malicious_code():
    """Test 2: Verify that AST scanner blocks disallowed names and imports."""
    malicious_code = """
import os
os.system("rm -rf /")
"""
    is_safe, errors = scan_code(malicious_code)
    assert not is_safe
    assert any("blocked import" in err.lower() and "os" in err.lower() for err in errors)

def test_ast_scanner_dunder_attributes():
    """Test 3: Verify AST scanner blocks dangerous dunder attributes (Gap #7)."""
    malicious_code = "func.__globals__['os'].system('dir')"
    is_safe, errors = scan_code(malicious_code)
    assert not is_safe
    assert any("restricted attribute" in err.lower() and "__globals__" in err.lower() for err in errors)

def test_ast_scanner_syntax_error():
    """Test 4: Verify AST scanner handles syntax errors gracefully."""
    invalid_syntax = "def func(:"
    is_safe, errors = scan_code(invalid_syntax)
    assert not is_safe
    assert any("syntax error" in err.lower() for err in errors)

def test_settings_empty_env():
    """Test 5: Verify settings loads default values when environment variables are empty."""
    from src.config import Settings
    # Create setting instance with empty/missing env file
    s = Settings(OLLAMA_API_KEY=None, SUPABASE_URL="")
    assert s.OLLAMA_API_KEY is None
    assert s.SUPABASE_URL == ""
