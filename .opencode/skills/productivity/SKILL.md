# Productivity (v1.3.0)

Manage tasks, plan your day, and build up memory of important context about your work. Syncs with your calendar, email, and chat to keep everything organized and on track.

## Commands

### /productivity:start
Initialize the task and memory systems, then open the unified dashboard. Creates `TASKS.md`, `CLAUDE.md`, and `memory/` if they don't exist. On first run, bootstraps memory by scanning your existing task list for shorthand (nicknames, acronyms, project codenames).

### /productivity:update [--comprehensive]
Sync tasks from external sources and refresh memory. Default mode fetches tasks from project trackers, triages stale items, and decodes tasks for memory gaps. Use `--comprehensive` for a deep scan of chat, email, calendar, and documents to flag missed todos and suggest new memories.

## Memory Management

Two-tier memory system for understanding workplace shorthand:

- **CLAUDE.md** — Hot cache (~50-80 lines). Top ~30 people, ~30 common acronyms, active projects, preferences. Covers 90% of daily decoding needs.
- **memory/** directory — Full knowledge base. Contains `glossary.md` (complete decoder ring), `people/{name}.md`, `projects/{name}.md`, `context/company.md`.

**Lookup flow**: Check CLAUDE.md first, then memory/glossary.md, then memory/people or projects, then ask the user.

## Task Management

Tasks tracked in `TASKS.md` with sections: Active, Waiting On, Someday, Done.

**Format**: `- [ ] **Task title** - context, for whom, due date`

Includes a visual `dashboard.html` for drag-and-drop task management.

## Workflows

- **Bootstrap memory**: Use `/productivity:start` to extract people, projects, and terms from your task list
- **Update tasks**: Use `/productivity:update` to sync from Asana, Linear, Jira, GitHub Issues
- **Decode shorthand**: Automatically resolves nicknames, acronyms, and codenames before acting
- **Fill gaps**: Presents unknown terms interactively and stores them in appropriate memory files
- **Comprehensive scan**: Catches todos buried in chat, email, and calendar

## Conventions

- Bold terms in CLAUDE.md for scannability
- Keep CLAUDE.md under ~100 lines
- Filenames: lowercase, hyphens
- Always capture nicknames and alternate names
- Promote frequently used terms to CLAUDE.md; demote stale ones to memory/
