# Engineering (v1.2.2)

Expert software engineering workflows: architecture review, code review, debugging, system design, testing strategy, incident response, deployment checklists, documentation, technical debt, and standup notes.

## Commands

### /engineering:architecture
Review system architecture against requirements. Produces Architecture Review doc covering business context, architecture overview, component analysis, data flow, constraints, risks, and recommendations.

### /engineering:code-review
Systematic code review producing a structured output with summary, code quality, security, performance, correctness, and maintainability findings. Each finding has severity, location, description, and suggestion. Optionally includes automated bug detection for Python, JavaScript, TypeScript, Go, Rust, and Java.

### /engineering:debug
Structured debugging workflow. 1) Gather context (symptoms, environment, reproduction steps, recent changes), 2) Form hypotheses, 3) Investigate with tests/logs, 4) Implement fix with regression test. Logs findings to `debug-sessions/`.

### /engineering:deploy-checklist
Generate deployment checklists for web apps, mobile releases, infrastructure changes, and database migrations. Covers pre-deploy, deploy steps, and post-deploy monitoring with a consistent checklist format.

### /engineering:documentation
Generate README, API docs, architecture decision records (ADRs), or runbooks. ADRs follow MADR format (title, status, context, decision, consequences). Asks clarifying questions to ensure completeness.

### /engineering:incident-response
Structured incident response. 1) Acknowledge & classify (severity: SEV1-4), 2) Assemble response team, 3) Investigate (timeline, hypothesis log), 4) Mitigate, 5) Resolve, 6) Post-mortem. Logs to `incidents/`.

### /engineering:standup
Generate a standup summary from git log, PRs, tickets, or free-form notes. Categorizes into:做了什么 (Did), 正在做 (Doing), 阻碍 (Blockers), 计划 (Plans).

### /engineering:system-design
Lead system design interviews or produce design documents. Follows: 1) Clarify requirements, 2) High-level design, 3) Deep dive, 4) Wrap-up. Covers functional/non-functional requirements, data model, API design, component diagram, data flow, trade-offs, and future roadmap.

### /engineering:tech-debt
Identify, prioritize, and track technical debt. Produces a Tech Debt Inventory with quadrant assessment (High/Low impact × Easy/Hard to fix). Logs to `tech-debt/`.

### /engineering:testing-strategy
Design comprehensive test strategy. Analyzes system architecture and risk areas. Outputs testing approach, tiered test pyramid, tooling recommendations, CI/CD integration, and test matrices.

## Workflows

- **Review code**: `/engineering:code-review` on a diff or PR
- **Debug an issue**: `/engineering:debug` with error description and reproduction steps
- **Design a system**: `/engineering:system-design` with requirements
- **Respond to incident**: `/engineering:incident-response` with symptoms
- **Plan testing**: `/engineering:testing-strategy` describing the system
- **Document architecture**: `/engineering:architecture` or `/engineering:documentation`
