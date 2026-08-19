# Canonical Triage Labels & Workflow Guide

Agent Auto-Pilot utilizes a canonical 5-label triage lifecycle to govern how issues move between human triage, automated agent implementation, developer feedback, and completion.

## The 5 Canonical Labels

| Label | Purpose | Orchestrator Action |
| :--- | :--- | :--- |
| `ready-for-agent` | Issue is refined, acceptance criteria are clear, and ready to be picked up. | **Picks up task** when all blocker dependencies are closed. Spawns git worktree and runs `/implement`. |
| `needs-info` | Agent hit an ambiguity or requires clarification and posted a question in comments. | **Pauses task**. Preserves worktree state, fires macOS desktop notification, and waits for human reply. |
| `ready-for-human` | Task requires manual human intervention, code review, or complex triage. | **Leaves task parked**. Preserves worktree until human finishes review or returns it to `ready-for-agent`. |
| `needs-triage` | Newly filed issue awaiting initial classification or acceptance criteria. | **Ignored** by agent worker pool until marked `ready-for-agent`. |
| `wontfix` | Issue rejected or deemed unnecessary. | **Ignored** by orchestrator (treated as non-blocking terminal). |

---

## Dependency & Relation Syntax

You can express issue hierarchies and blockers directly in GitHub issue descriptions:

### 1. Blockers & Prerequisites
```markdown
Blocked by #101
Depends on: #102, #103
```
*The orchestrator will wait until #101, #102, and #103 are closed before dispatching this issue.*

### 2. Parent / Child Relations (Specs & Tickets)
```markdown
Parent: #50
```
or inside a Spec:
```markdown
### Child Subtasks
- [ ] #51
- [ ] #52
- [x] #53
```

---

## Human-in-the-Loop Feedback Flow

1. **Agent Pauses**:
   If an agent gets stuck, it adds `needs-info` and posts a comment explaining the question.
2. **Developer Responds**:
   Developer replies on GitHub and removes `needs-info` / adds `ready-for-agent`.
3. **Session Resumes**:
   Agent Auto-Pilot loads the existing worktree, fetches the developer's reply, and resumes `/implement` with full continuation context.
