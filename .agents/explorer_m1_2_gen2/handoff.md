# Handoff Report — explorer_m1_2_gen2

## 1. Observation
We observed the following evidence from the codebase investigation and test suite executions:

1.  **Incorrect Trigger Usages in Workflows**:
    Using our code search tool, we scanned the codebase for `.Trigger(` and found the following:
    *   `src/workflows/message_handler.py:22`: `trigger=inngest.Trigger(event="slack/event"),`
    *   `src/workflows/message_handler.py:120`: `trigger=inngest.Trigger(event="slack/command"),`
    *   `src/workflows/proactive_loop.py:20`: `trigger=inngest.Trigger(cron="*/15 * * * *"),`
    *   `src/workflows/skill_installer.py:21`: `trigger=inngest.Trigger(event="skill/install"),`
    *   `src/workflows/workflow_executor.py:27`: `trigger=inngest.Trigger(event="workflow/trigger"),`
    *   `src/workflows/workspace_installer.py:15`: `trigger=inngest.Trigger(event="workspace/install"),`

2.  **Facade Patch in Tests**:
    In `tests/conftest.py` lines 5-6:
    ```python
    if not hasattr(inngest, "Trigger"):
        inngest.Trigger = lambda *args, **kwargs: inngest.TriggerCron(*args, **kwargs) if "cron" in kwargs else inngest.TriggerEvent(*args, **kwargs)
    ```

3.  **Vercel Pathing import failure**:
    When running `inngest_handler.py` under simulated Vercel python pathing environment (which isolates `sys.path`), it raises:
    ```
    ModuleNotFoundError: No module named 'src'
    ```

4.  **TypeError on Decorated Functions in Unit Tests**:
    When executing `pytest` with the facade patch bypass removed, direct tests of workflows failed with:
    ```
    E       TypeError: 'Function' object is not callable
    ```
    This was observed at line 193 in `tests/e2e/tier4/test_real_world_scenarios.py`:
    ```python
    result = await install_skill_from_github(ctx, step)
    ```

## 2. Logic Chain
1.  **Issue 1: Production Workflows Fail on Startup**:
    *   `inngest-py` version `0.5.18` has no attribute `Trigger` (supported classes are `TriggerEvent` and `TriggerCron`).
    *   Therefore, running the application in production without conftest's facade patch results in startup crash due to `AttributeError` when importing workflow modules.
    *   **Remedy**: Change all instances of `inngest.Trigger` to `inngest.TriggerEvent` (for events) or `inngest.TriggerCron` (for cron patterns).

2.  **Issue 2: Facade Patch Conceals Issues & Fails Direct Testing**:
    *   `tests/conftest.py` patches `inngest.Trigger` globally to hide the production bug during test execution.
    *   **Remedy**: Remove the patch from `tests/conftest.py` completely.
    *   However, once removed, `inngest.Function` objects (created by the `@inngest_client.create_function` decorator) are not callable, causing direct tests like `test_custom_skill_github_installer_scenario` to fail.
    *   **Remedy**: Patch `inngest.Function.__call__` in `tests/conftest.py` to route to `self._handler`, enabling direct testing calls on the workflow functions without altering clean production code.

3.  **Issue 3: Vercel Pathing Failures**:
    *   In the Vercel execution context, the working directory is configured such that the project root is not included in `sys.path`.
    *   Consequently, `from src.core...` in `api/inngest_handler.py` fails to find `src`.
    *   **Remedy**: Inject a dynamic `sys.path` adjustment at the top of `api/inngest_handler.py` resolving the project root directory relative to `__file__`.

## 3. Caveats
No caveats. The proposed modifications resolve all the identified issues without introducing code changes in `tests/` except for the conftest test-utility adjustments.

## 4. Conclusion
To restore integrity to Milestone 1 and align KlawHub with Vercel deployment requirements, the worker should execute the following changes:
1.  Replace `inngest.Trigger` usages in the 5 workflow files with `inngest.TriggerEvent` and `inngest.TriggerCron`.
2.  Clean up the facade patch from `tests/conftest.py` and replace it with `inngest.Function.__call__` wrapper routing to `self._handler`.
3.  Add dynamic root-path injection to `sys.path` in `api/inngest_handler.py`.

Refer to `c:\Users\HP\klaw\klawhub\.agents\explorer_m1_2_gen2\analysis.md` for exact replacement snippets.

## 5. Verification Method
1.  **Vercel Pathing Verification**:
    Run the simulated Vercel python pathing environment command:
    ```powershell
    python -c "import sys; sys.path = [p for p in sys.path if 'klawhub' not in p.lower() or 'site-packages' in p.lower()]; sys.path.insert(0, r'c:\Users\HP\klaw\klawhub\api'); import inngest_handler; print('Vercel import verification succeeded!')"
    ```
2.  **Test Suite Execution**:
    Run the full pytest suite inside the virtual environment:
    ```powershell
    .venv\Scripts\pytest
    ```
    Ensure that all tests compile, imports succeed, and tests execute without `TypeError: 'Function' object is not callable` or configuration invalidation exceptions.
