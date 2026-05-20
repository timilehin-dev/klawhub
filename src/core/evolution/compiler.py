import ast
import logging
from typing import Set

logger = logging.getLogger("klawhub.core.evolution.compiler")

class SecurityError(Exception):
    """Raised when the AST static scanner detects forbidden or malicious code expressions."""
    pass

class ASTSafetyScanner(ast.NodeVisitor):
    """Elite static AST safety scanner that parses Python code before dynamic execution.
    
    Verifies that no hidden backdoor execution routes exist.
    """

    # Safe built-in functions that do not interact with the host system
    ALLOWED_BUILTINS: Set[str] = {
        'abs', 'all', 'any', 'bin', 'bool', 'bytes', 'bytearray', 'chr', 'dict',
        'divmod', 'enumerate', 'filter', 'float', 'format', 'hash', 'hex', 'int',
        'isinstance', 'issubclass', 'iter', 'len', 'list', 'map', 'max', 'min',
        'next', 'oct', 'ord', 'pow', 'range', 'repr', 'reversed', 'round', 'set',
        'frozenset', 'slice', 'sorted', 'str', 'sum', 'tuple', 'zip'
    }

    # Sandbox-expanded allowed built-ins (silently allowed for containers)
    SANDBOX_BUILTINS: Set[str] = ALLOWED_BUILTINS.union({
        'open', 'getattr', 'setattr', 'delattr', 'compile'
    })

    # Safe third-party or standard packages whitelisted for scientific/operational tasks
    WHITELISTED_MODULES: Set[str] = {
        'pandas', 'numpy', 'requests', 'urllib3', 'json', 'math', 'datetime',
        'time', 're', 'csv', 'slack_sdk', 'google', 'httpx', 'collections', 'itertools',
        'scipy', 'sklearn', 'matplotlib', 'seaborn', 'plotly', 'torch', 'transformers', 
        'crawl4ai', 'weasyprint', 'fastembed', 'pypandoc', 'spacy', 'nltk', 'polars',
        'lightpanda', 'playwright', 'pdfplumber', 'markdown', 'typst', 'xml', 'uuid',
        'hashlib', 'hmac', 'base64', 'io', 'zipfile', 'tarfile', 'random', 'functools'
    }

    # Sandbox-expanded whitelisted modules (silently allowed for containers)
    SANDBOX_MODULES: Set[str] = WHITELISTED_MODULES.union({
        'os', 'sys', 'subprocess', 'shutil', 'tempfile'
    })

    def __init__(self, code: str, isolation_profile: str = "strict"):
        self.code = code
        self.tree = ast.parse(code)
        self.isolation_profile = isolation_profile
        self.allowed_builtins = self.SANDBOX_BUILTINS if isolation_profile == "sandbox" else self.ALLOWED_BUILTINS
        self.allowed_modules = self.SANDBOX_MODULES if isolation_profile == "sandbox" else self.WHITELISTED_MODULES

    def scan(self) -> None:
        """Starts dynamic tree traversal. Raises SecurityError if unsafe constructs are found."""
        self.visit(self.tree)

    def visit_Import(self, node: ast.Import) -> None:
        """Inspects direct imports (e.g. import os)."""
        for name in node.names:
            base_module = name.name.split('.')[0]
            if base_module not in self.allowed_modules:
                raise SecurityError(
                    f"Forbidden import '{name.name}' detected on line {node.lineno}. "
                    f"Only whitelisted utility modules are allowed."
                )
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        """Inspects structured imports (e.g. from os import system)."""
        if not node.module:
            raise SecurityError(f"Relative imports are forbidden on line {node.lineno}.")
            
        base_module = node.module.split('.')[0]
        if base_module not in self.allowed_modules:
            raise SecurityError(
                f"Forbidden import source '{node.module}' detected on line {node.lineno}. "
                f"Only whitelisted utility modules are allowed."
            )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        """Validates all function executions to catch builtins escapes or dynamic evaluations."""
        # 1. Catch direct calls (e.g., eval("code"))
        if isinstance(node.func, ast.Name):
            func_name = node.func.id
            if func_name not in self.allowed_builtins:
                # Catch forbidden system builtins
                if func_name in {'eval', 'exec', 'compile', '__import__', 'open', 'getattr', 'setattr', 'delattr'}:
                    raise SecurityError(
                        f"Execution of high-risk builtin '{func_name}()' blocked on line {node.lineno}."
                    )
        
        # 2. Catch indirect calls or dynamic escapes (e.g., getattr(x, 'y')())
        elif isinstance(node.func, ast.Attribute):
            attr_name = node.func.attr
            if attr_name in {'__subclasses__', '__globals__', '__code__', '__func__'}:
                raise SecurityError(
                    f"Forbidden object metadata lookup '{attr_name}' blocked on line {node.lineno}."
                )

        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        """Catches attribute accesses like object.__class__ or object.__globals__."""
        if node.attr in {
            '__class__', '__globals__', '__code__', '__func__', '__import__',
            '__bases__', '__mro__', '__dict__', '__subclasses__',
            '__builtins__', '__loader__', '__spec__', '__wrapped__',
        }:
            # Exceptions for sandbox isolation profile to allow standard library operations
            if self.isolation_profile == "sandbox" and node.attr in {'__dict__', '__wrapped__'}:
                pass
            else:
                raise SecurityError(
                    f"Forbidden structural attribute access '{node.attr}' blocked on line {node.lineno}."
                )
        self.generic_visit(node)


class EvolutionCompiler:
    """Combines the static AST scanner and dynamic hot-swapping compilation.
    
    Validates source scripts and compiles them safely in-memory for immediate execution.
    """

    @classmethod
    def compile_skill(cls, source_code: str, skill_name: str, isolation_profile: str = "strict") -> dict:
        """Scans and safely compiles python code in-memory.
        
        Returns the local namespace dictionary containing the newly registered definitions.
        """
        # Run strict AST safety validation
        scanner = ASTSafetyScanner(source_code, isolation_profile=isolation_profile)
        try:
            scanner.scan()
        except SecurityError as se:
            logger.critical(f"Skill compilation rejected due to security violations in '{skill_name}': {str(se)}")
            raise se
        except Exception as e:
            logger.error(f"Failed to parse AST for '{skill_name}': {str(e)}")
            raise ValueError(f"Syntax validation failed: {str(e)}")

        # Create isolated namespace environment
        local_namespace = {}
        # Ensure only allowed builtins are accessible inside the execution environment
        # Handle case where __builtins__ is a module object rather than a dictionary
        builtins_dict = __builtins__ if isinstance(__builtins__, dict) else __builtins__.__dict__
        allowed_builtins_set = ASTSafetyScanner.SANDBOX_BUILTINS if isolation_profile == "sandbox" else ASTSafetyScanner.ALLOWED_BUILTINS
        safe_builtins = {k: builtins_dict[k] for k in allowed_builtins_set if k in builtins_dict}

        # Inject a constrained __import__ that only allows whitelisted modules at runtime.
        # This is a defense-in-depth layer: AST scanning already blocked forbidden imports
        # statically, but this prevents any dynamic bypass at exec() time.
        _real_import = builtins_dict["__import__"]
        _whitelisted = ASTSafetyScanner.SANDBOX_MODULES if isolation_profile == "sandbox" else ASTSafetyScanner.WHITELISTED_MODULES

        def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
            base = name.split(".")[0]
            if base not in _whitelisted:
                raise SecurityError(
                    f"Runtime import of forbidden module '{name}' blocked by sandbox."
                )
            return _real_import(name, globals, locals, fromlist, level)

        safe_builtins["__import__"] = _safe_import

        global_namespace = {
            "__builtins__": safe_builtins,
            "__name__": f"klawhub.dynamic_skills.{skill_name}"
        }

        try:
            # Compile and execute within a unified global namespace so that functions close over
            # the imports and module-level variables correctly (fixing Python scoping issues).
            compiled_code = compile(source_code, f"<dynamic_skill_{skill_name}>", "exec")
            exec(compiled_code, global_namespace)
            
            # Extract the compiled functions/variables to return to the registry
            for k, v in global_namespace.items():
                if k not in {"__builtins__", "__name__"}:
                    local_namespace[k] = v
                    
            logger.info(f"Successfully validated and compiled dynamic skill '{skill_name}' in-memory.")
            return local_namespace
        except SecurityError:
            raise
        except Exception as e:
            logger.error(f"Runtime execution failed during skill compilation: {str(e)}")
            raise RuntimeError(f"Skill initialization failed: {str(e)}")
