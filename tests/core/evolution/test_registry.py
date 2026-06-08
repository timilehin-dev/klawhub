import pytest
from src.core.evolution.registry import DynamicSkillRegistry

def test_register_skill_success():
    """Test successful dynamic skill registration."""
    DynamicSkillRegistry.clear_registry()
    source_code = """
def handler(event):
    return "success"
"""
    DynamicSkillRegistry.register_skill("test_skill", source_code)
    skill = DynamicSkillRegistry.get_skill("test_skill")
    assert skill(None) == "success"

def test_register_skill_missing_entrypoint():
    """Test skill registration fails when entrypoint is missing."""
    DynamicSkillRegistry.clear_registry()
    source_code = """
def not_handler(event):
    return "success"
"""
    with pytest.raises(ValueError, match="Entrypoint function 'handler' not found"):
        DynamicSkillRegistry.register_skill("test_skill", source_code)

def test_register_skill_syntax_error():
    """Test skill registration fails on syntax error."""
    DynamicSkillRegistry.clear_registry()
    source_code = """
def handler(event)
    return "success"
"""
    with pytest.raises(SyntaxError):
        DynamicSkillRegistry.register_skill("test_skill", source_code)

def test_register_skill_security_error():
    """Test skill registration fails on security violation."""
    DynamicSkillRegistry.clear_registry()
    source_code = """
import os

def handler(event):
    os.system("echo 'hacked'")
    return "success"
"""
    with pytest.raises(Exception):
        DynamicSkillRegistry.register_skill("test_skill", source_code, isolation_profile="strict")
