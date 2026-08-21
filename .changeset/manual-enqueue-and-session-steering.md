---
"imagos": minor
---

feat: manual issue enqueue, issue discussion comments in prompts, Telegram session steering, and contextual command suggestions

- **Manual issue enqueue**: Added in-memory priority queue scheduling (`/enqueue`, `/run`, `/dispatch`, and `e` key in TUI) allowing any issue to be queued regardless of blocked or spec state, with confirmation prompts, `--force` bypass, on-demand GitHub fetching, and automated label synchronization (`ready-for-agent` added, review labels cleared).
- **Issue comments in task prompts**: Query GraphQL issue comments (up to 50) and embed discussion threads, notes, and triage briefs directly into runner prompts and guidelines.
- **Telegram session steering**: Added `/steer [issueNumber] <instructions>` command and notification swipe-to-reply steering, providing immediate injection confirmation followed by an 8-second live tail impact report summarizing agent tool calls, status, and worktree git diffs.
- **Contextual command suggestions**: Running `/steer`, `/enqueue`, `/inspect`, `/logs`, `/pause`, `/resume`, or `/help` without arguments dynamically embeds live session context (active workers, paused tasks, and enqueued/ready issues) with tap-to-copy monospace command shortcuts.
