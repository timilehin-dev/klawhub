# Design (v1.2.1)

Expert design workflows: accessibility review, design critique, design handoff, design systems, user research synthesis, user research, and UX copywriting.

## Commands

### /design:accessibility-review
Audit designs or code for WCAG 2.1/2.2 compliance (Level A, AA, AAA). Checks: color contrast, keyboard navigation, screen reader compatibility, focus indicators, touch targets, motion, and more. Produces severity-rated findings with remediation steps.

### /design:design-critique
Structure design critique sessions. Roles: Presenter, Facilitator, Scribe, Participants. Format: Context → Problem → Design → Feedback (I like, I wish, What if). Follow-ups captured as action items.

### /design:design-handoff
Prepare assets and specs for engineering handoff. Covers: final mockups, specs/measurements, assets (SVGs, icons, images), interaction specs (micro-interactions, transitions, empty/error/loading states), responsive behavior, and accessibility notes. Encourages synchronous handoff meeting.

### /design:design-system
Create or audit design system documentation. Sections: Design Tokens (colors, typography, spacing, elevation), Component Library (button, input, card, nav, modal, etc.), Patterns (layouts, forms, data display, navigation), and Guidelines (voice/tone, accessibility, motion). Includes atomic design principles.

### /design:research-synthesis
Synthesize raw user research into deliverables. Input: interview recordings, transcripts, survey data, analytics. Outputs: affinity map, themes, user journey map, personas, opportunity areas, recommendations. Logs to `research-sessions/`.

### /design:user-research
Design and plan user research studies. 1) Clarify goals, 2) Choose method (usability testing, interviews, surveys, field studies, diary studies, card sorting, A/B testing, analytics review), 3) Plan participants (criteria, screener, sample size 5-8/session), 4) Discussion guide, 5) Logistics (consent forms, incentives, tools). Output: research plan.

### /design:ux-copy
Write and improve UX copy for interfaces. Follows: 1) Understand context and user needs, 2) Apply UX writing principles (concise, clear, helpful, consistent, inclusive, on-brand), 3) Consider microcopy, error messages, onboarding, empty states, notifications, tooltips. Includes copy audit framework.

## Workflows

- **Review accessibility**: `/design:accessibility-review` on Figma file or HTML/CSS
- **Run a critique**: `/design:design-critique` with design context
- **Handoff to engineering**: `/design:design-handoff` with final mockups
- **Build a design system**: `/design:design-system` with brand guidelines
- **Synthesize research**: `/design:research-synthesis` with raw notes/interviews
- **Plan user research**: `/design:user-research` with research goals
- **Write UX copy**: `/design:ux-copy` for screens or error messages
