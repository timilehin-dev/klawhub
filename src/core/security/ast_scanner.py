"""
AST-based static code security scanner.

Scans user/agent-generated Python code before it is executed in the sandbox.
Blocks dangerous imports (os, subprocess, sys, socket) and dangerous builtins
(eval, exec, __import__) while permitting data-science and document-processing
libraries to use their internal dunder methods freely.

Fix applied: replaced `startswith('__')` dunder catch-all with a specific
blocklist — the old approach incorrectly blocked harmless pandas/numpy methods
like __len__, __str__, __init__ etc., causing all data-science skills to fail.
"""
import ast
from typing import Set, Tuple, List

# Builtins that should never appear in agent-generated code
BLOCKED_NAMES: Set[str] = {
    "eval", "exec", "__import__", "compile", "open", "input", "breakpoint",
}

# Attribute accesses that allow privilege escalation or sandbox escape
BLOCKED_ATTRS: Set[str] = {
    "__globals__", "__code__", "__builtins__", "__subclasses__",
    "__import__", "__loader__", "__spec__", "__reduce__", "__reduce_ex__",
}

# Module imports that give raw OS / network / process access
BLOCKED_IMPORTS: Set[str] = {
    "os", "subprocess", "sys", "socket", "shutil", "pty", "platform",
    "ctypes", "multiprocessing", "threading", "signal", "gc",
    "importlib", "pkgutil", "site",
}

# Calls that can introspect or escape the sandbox
BLOCKED_CALLS: Set[str] = {
    "globals", "locals", "eval", "exec", "__import__", "open",
    "compile", "getattr", "setattr", "delattr",
}


class ASTScanner(ast.NodeVisitor):
    def __init__(self):
        self.errors: List[str] = []

    def check_code(self, code_str: str) -> Tuple[bool, List[str]]:
        """Parse and recursively inspect the AST of `code_str`."""
        try:
            tree = ast.parse(code_str)
            self.errors = []
            self.visit(tree)
            return (len(self.errors) == 0), self.errors
        except SyntaxError as e:
            return False, [f"Syntax error at line {e.lineno}: {e.msg}"]
        except Exception as e:
            return False, [f"AST parse failed: {str(e)}"]

    def visit_Import(self, node: ast.Import):
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root in BLOCKED_IMPORTS:
                self.errors.append(
                    f"Line {node.lineno}: Blocked import of restricted module '{alias.name}'"
                )
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom):
        if node.module:
            root = node.module.split(".")[0]
            if root in BLOCKED_IMPORTS:
                self.errors.append(
                    f"Line {node.lineno}: Blocked 'from {node.module} import ...' — restricted module"
                )
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name):
        if node.id in BLOCKED_NAMES:
            self.errors.append(
                f"Line {node.lineno}: Use of blocked name '{node.id}'"
            )
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute):
        # ✅ FIX: Only block explicitly dangerous dunder attrs, NOT all dunders.
        # pandas/numpy/sklearn expose harmless dunders like __len__, __iter__, __str__
        # which the old `startswith('__')` check wrongly blocked.
        if node.attr in BLOCKED_ATTRS:
            self.errors.append(
                f"Line {node.lineno}: Access to restricted attribute '{node.attr}'"
            )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id in BLOCKED_CALLS:
            self.errors.append(
                f"Line {node.lineno}: Call to restricted function '{node.func.id}()'"
            )
        self.generic_visit(node)


def scan_code(code_str: str) -> Tuple[bool, List[str]]:
    """Convenience function — scan code and return (is_safe, errors)."""
    return ASTScanner().check_code(code_str)
