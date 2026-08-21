# imagos

## 0.8.0

### Minor Changes

- 9b30b84: feat: add triage backlog section under Issue DAG Queue

  - **Issue DAG Queue Triage Section**: Added a dedicated `📋 Needs Triage:` section in the Master Dashboard TUI and CLI table overview to view untriaged open issues (`needs-triage`).
  - **Interactive Backlog Drill-down**: Enabled selecting and inspecting the triage backlog in the interactive Category Issues View (press Enter on Needs Triage row), displaying the `📋 needs triage` status badge and supporting actions to enqueue, inspect, or open issues in browser.
  - **DAG Triage Queries**: Added `getTriageNodes()` to `IssueDAG` returning open un-triaged tasks and respecting spec scope.

## 0.7.0

### Minor Changes

- 5b44251: feat: interactive issue tree browser for TUI and Telegram remote control

  - **TUI Issue Tree Browser**: Added 2-level hierarchy view accessible via `/browse-issues` (aliases: `/browse`, `/issues`, `/tree`) showing open specifications with expand/collapse state (`▶`/`▼`), completion progress `[x/y completed]`, and indented child tickets (`├──`, `└──`) with dimmed checkmarks on closed tasks. Standalone issues are displayed with `●`.
  - **Keyboard Navigation & Controls**: Added `[Space]`/`[→]`/`[←]` to toggle specs, `[←]` on child items to collapse parent and return cursor to parent spec row, `[c]` to toggle open-only filter vs all tasks, `[a]` to toggle expand/collapse all, `[e]` to enqueue with confirmation, `[o]` to open in browser, `[p]` to pause/resume, `[k]` to kill worker and wipe worktree, and `[Enter]`/`[i]` to inspect live tail.
  - **Telegram Remote Interactive Browser**: Registered `/browse` in bot menu (`BOT_COMMANDS`) and implemented interactive drill-down navigation via inline message editing. Supports spec drill-down views, open-only filter toggling, per-task enqueue buttons, bulk enqueueing (`[⚡ Enqueue All Open Tasks]`), and return navigation (`[⬅️ Back to Tree]`).

## 0.6.0

### Minor Changes

- 12a4d6e: feat: manual issue enqueue, issue discussion comments in prompts, Telegram session steering, and contextual command suggestions

  - **Manual issue enqueue**: Added in-memory priority queue scheduling (`/enqueue`, `/run`, `/dispatch`, and `e` key in TUI) allowing any issue to be queued regardless of blocked or spec state, with confirmation prompts, `--force` bypass, on-demand GitHub fetching, and automated label synchronization (`ready-for-agent` added, review labels cleared).
  - **Issue comments in task prompts**: Query GraphQL issue comments (up to 50) and embed discussion threads, notes, and triage briefs directly into runner prompts and guidelines.
  - **Telegram session steering**: Added `/steer [issueNumber] <instructions>` command and notification swipe-to-reply steering, providing immediate injection confirmation followed by an 8-second live tail impact report summarizing agent tool calls, status, and worktree git diffs.
  - **Contextual command suggestions**: Running `/steer`, `/enqueue`, `/inspect`, `/logs`, `/pause`, `/resume`, or `/help` without arguments dynamically embeds live session context (active workers, paused tasks, and enqueued/ready issues) with tap-to-copy monospace command shortcuts.

### Patch Changes

- 37322a9: fix: enforce needs-triage on agent follow-up tasks, deduplicate runner prompts, and add 2-minute quota reset safety margin

  - Enforce `needs-triage` label on all agent-created follow-up subtasks (preventing unapproved task auto-enqueuing) with proposed solutions and reasoning at the bottom of the issue body.
  - Extract shared runner prompt builder (`src/runners/prompt.ts`) and streamline continuation prompts by omitting redundant task descriptions and guidelines.
  - Add 2-minute safety buffer to quota reset calculations to prevent premature boundary wakeups and rolling window re-triggering.
  - Add concise instructions in Telegram `needs-info` notifications for swipe-to-reply or manual GitHub issue comments.

## 0.5.0

### Minor Changes

- 3818766: feat: extensible Telegram remote control integration including interactive setup wizard (`imagos init`), runtime toggle flags (`imagos start --remote` / `--no-remote`), graceful shutdown on process signals (`SIGINT`/`SIGTERM`), slash command controls, interactive needs-info steering, one-tap quota resumption alerts, and outbound milestone notifications.

## 0.4.0

### Minor Changes

- 08b5faa: feat: add AI agent skills (`imagos-summary`, `imagos-spec-writer`) compatible with `vercel-labs/skills` (skills.sh) with human-only invocation, and add `/install-skills` command to CLI and TUI palette.

## 0.3.0

### Minor Changes

- a132f82: feat: add automated agent nudge loop for unmerged turns, dynamic autoMerge prompts, smooth TUI backlog scrolling, and unified specifications & scope management view.

### Patch Changes

- eebe384: fix: propagate parent spec blockers down to all child tickets in the DAG, support native GitHub issue relationships (`blockedBy`, `parent`, `subIssues`) via GraphQL, and automatically prune completed or closed specs from the active target scope with activity logging.

## 0.2.2

### Patch Changes

- d7f0b1f: docs: revamp README with comprehensive guide for Claude and Antigravity (agy) runners, runner label routing and fallback, multi-spec scoping, and quota management.

## 0.2.1

### Patch Changes

- 8f09d6b: fix: automatically detect unmerged PRs upon agent completion, attempt auto-merge if enabled, transition tasks to `ready-for-human` on GitHub to prevent infinite re-dispatch, and accurately display in-review worktrees in the dashboard.

## 0.2.0

### Minor Changes

- bd9d65e: Allow specifying multiple target specs when starting imagos and across CLI commands (`-s, --spec`, `--specs`, and `targetSpecs` in configuration).

## 0.1.1

### Patch Changes

- 1e01308: Initial release setup with automated publishing workflow and package metadata.
