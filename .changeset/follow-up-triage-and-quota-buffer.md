---
"imagos": patch
---

fix: enforce needs-triage on agent follow-up tasks, deduplicate runner prompts, and add 2-minute quota reset safety margin

- Enforce `needs-triage` label on all agent-created follow-up subtasks (preventing unapproved task auto-enqueuing) with proposed solutions and reasoning at the bottom of the issue body.
- Extract shared runner prompt builder (`src/runners/prompt.ts`) and streamline continuation prompts by omitting redundant task descriptions and guidelines.
- Add 2-minute safety buffer to quota reset calculations to prevent premature boundary wakeups and rolling window re-triggering.
- Add concise instructions in Telegram `needs-info` notifications for swipe-to-reply or manual GitHub issue comments.
