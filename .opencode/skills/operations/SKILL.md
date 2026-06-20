# Operations (v1.1.2)

Expert operations workflows: capacity planning, change management, compliance tracking, process documentation, process optimization, risk assessment, runbooks, status reporting, and vendor review.

## Commands

### /operations:capacity-plan
Create capacity plans for systems and infrastructure. Analyzes current usage, growth trends, and business drivers. Produces plan with current capacity, growth projections, trigger points, recommended actions, and cost estimates.

### /operations:change-request
Generate change request documentation. Sections: change description, rationale, implementation plan, rollback plan, risk assessment, testing done, communication plan, schedule, approvers.

### /operations:compliance-tracking
Track and manage compliance requirements. Helps identify applicable standards (SOC2, ISO27001, HIPAA, GDPR, PCI DSS, SOX, FedRAMP), map controls, assess evidence, identify gaps, and track remediation. Logs to `compliance/`.

### /operations:process-doc
Document processes with clear step-by-step instructions. Format: Title, Purpose, Scope, Definitions, Responsibilities, Prerequisites, Procedure (numbered steps), Inputs/Outputs, Quality Checkpoints, KPIs, References. Includes visual flowchart generation.

### /operations:process-optimization
Analyze and improve existing processes. 1) Map current state with swimlane diagram, 2) Identify bottlenecks via value stream mapping (VA/NVA/NNVA), 3) Propose improvements with impact/effort matrix, 4) Design future state. Incorporates Lean, Six Sigma, Kaizen, Theory of Constraints.

### /operations:risk-assessment
Identify and assess operational risks. Produces risk register with: risk description, category, likelihood (1-5), impact (1-5), risk score, inherent vs residual risk, treatment plan (avoid, mitigate, transfer, accept), contingency plan, owner, review date. Includes risk heatmap.

### /operations:runbook
Create operational runbooks for common tasks and incidents. Sections: Title, Description, Prerequisites, Severity, Step-by-step procedure, Verification, Escalation, Related runbooks. Logs to `runbooks/`.

### /operations:status-report
Generate status reports. Gathers input from context, git log, tickets, or free-form notes. Sections: Reporting Period, Key Accomplishments, OKR Progress, Metrics/Charts, Risks & Issues, Next Steps. Outputs Slack-friendly and email-friendly summaries.

### /operations:vendor-review
Evaluate vendors and tools. Creates structured review with: evaluation criteria (weighted), vendor comparison matrix, security assessment (SOC2, encryption, data residency, SSO, audit logs), cost analysis (TCO), risk assessment, implementation effort, and final recommendation.

## Workflows

- **Plan capacity**: `/operations:capacity-plan` with system metrics and growth data
- **Document a process**: `/operations:process-doc` describing the workflow
- **Create a runbook**: `/operations:runbook` for common operational tasks
- **Assess risk**: `/operations:risk-assessment` for a project or system
- **Optimize process**: `/operations:process-optimization` analyzing a bottleneck
- **Review vendor**: `/operations:vendor-review` comparing options
- **Track compliance**: `/operations:compliance-tracking` for applicable standards
