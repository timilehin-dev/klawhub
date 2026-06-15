## 2026-06-15T11:35:48Z
<USER_REQUEST>
Act as a Worker for Milestone 1, Iteration 2 (Inngest triggers, conftest facade, Vercel import issues) of KlawHub.
Your working directory is: c:\Users\HP\klaw\klawhub\.agents\worker_m1_2
Your tasks are:
1. Replace all invalid `inngest.Trigger` usages with the correct subclass:
   - `src/workflows/message_handler.py`: Change `inngest.Trigger` (for slack/event and slack/command) to `inngest.TriggerEvent`.
   - `src/workflows/skill_installer.py`: Change `inngest.Trigger` (for skill/install) to `inngest.TriggerEvent`.
   - `src/workflows/workflow_executor.py`: Change `inngest.Trigger` (for workflow/trigger) to `inngest.TriggerEvent`.
   - `src/workflows/workspace_installer.py`: Change `inngest.Trigger` (for workspace/install) to `inngest.TriggerEvent`.
   - `src/workflows/proactive_loop.py`: Change `inngest.Trigger` (for cron) to `inngest.TriggerCron`.
2. Clean up `tests/conftest.py`:
   - Remove the facade patch that defines `inngest.Trigger`.
   - Implement the test-helper patch to make `inngest.Function` objects callable by adding:
     ```python
     if not hasattr(inngest.Function, "__call__"):
         inngest.Function.__call__ = lambda self, *args, **kwargs: self._handler(*args, **kwargs)
     ```
3. Fix Vercel import pathing in `api/inngest_handler.py`:
   - Add the dynamic path resolution at the top of the file before importing `src` modules:
     ```python
     import os
     import sys
     project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
     if project_root not in sys.path:
         sys.path.insert(0, project_root)
     ```
4. Verify changes:
   - Run the simulated Vercel python pathing environment command:
     ```powershell
     python -c "import sys; sys.path = [p for p in sys.path if 'klawhub' not in p.lower() or 'site-packages' in p.lower()]; sys.path.insert(0, r'c:\Users\HP\klaw\klawhub\api'); import inngest_handler; print('Vercel import verification succeeded!')"
     ```
   - Run the verification script: `python verify_all_27.py`
   - Run pytest: `pytest`
5. Write a completion report and handoff.md in your working directory.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
</USER_REQUEST>
