# Sales (v1.1.1)

Expert sales workflows: account research, call preparation, call summaries, competitive intelligence, asset creation, daily briefing, outreach drafting, forecasting, and pipeline review.

## Commands

### /sales:account-research
Deep-dive research on target accounts. Analyzes company overview, recent news, financial health, competitive positioning, technology stack (BuiltWith, Wappalyzer), organizational chart, and relevant contacts. Outputs account research brief with strategic recommendations and conversation starters.

### /sales:call-prep
Prepare for sales calls (discovery, demo, presentation, negotiation, close). Produces call brief with: participant profiles, talking points, questions, objection handling, next steps. Customizes based on call type and persona.

### /sales:call-summary
Summarize sales calls from transcripts or notes. Extracts: key decisions, commitments, objections, action items, next steps. Formats for CRM and internal distribution. Includes sentiment and talk ratio analysis.

### /sales:competitive-intelligence
Track and analyze competitors. SWOT analysis, positioning comparison, pricing/feature battle cards, recent moves (funding, acquisitions, product launches, partnerships), win/loss analysis. Logs to `competitive-intel/`.

### /sales:create-an-asset
Create sales assets: one-pagers, pitch decks, case studies, proposal templates, comparison matrices, ROI calculators, white papers. Follows: 1) Audience & goal, 2) Outline, 3) Draft, 4) Review against brand guidelines.

### /sales:daily-briefing
Generate daily sales briefing. Compiles: today's meetings, top priorities, recent deal activity, competitive alerts, team updates. Prioritizes urgent items.

### /sales:draft-outreach
Write personalized outreach messages. Supports email, LinkedIn, and cold call scripts. For email/LinkedIn: subject line, personalization, value prop, CTA. For calls: opener, qualification questions, objection handling, CTA. A/B variants available.

### /sales:forecast
Create and analyze sales forecasts. Commit, Upside, Pipeline categories. Generates weighted forecast, historical accuracy analysis, trend analysis, gap analysis, and scenario modeling (best case, base case, worst case).

### /sales:pipeline-review
Review sales pipeline health. Analyzes: deal distribution by stage, aging analysis, velocity, conversion rates, coverage ratios, at-risk deals, top opportunities. Generates action items for stalled deals.

## Workflows

- **Research an account**: `/sales:account-research` with company name/URL
- **Prepare for a call**: `/sales:call-prep` with call type and prospect info
- **Summarize a call**: `/sales:call-summary` with transcript or notes
- **Draft outreach**: `/sales:draft-outreach` for email or LinkedIn
- **Review pipeline**: `/sales:pipeline-review` with CRM data
- **Track competitors**: `/sales:competitive-intelligence` updating on a competitor
- **Create forecast**: `/sales:forecast` with current pipeline data
