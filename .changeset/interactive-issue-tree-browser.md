---
"imagos": minor
---

feat: interactive issue tree browser for TUI and Telegram remote control

- **TUI Issue Tree Browser**: Added 2-level hierarchy view accessible via `/browse-issues` (aliases: `/browse`, `/issues`, `/tree`) showing open specifications with expand/collapse state (`▶`/`▼`), completion progress `[x/y completed]`, and indented child tickets (`├──`, `└──`) with dimmed checkmarks on closed tasks. Standalone issues are displayed with `●`.
- **Keyboard Navigation & Controls**: Added `[Space]`/`[→]`/`[←]` to toggle specs, `[←]` on child items to collapse parent and return cursor to parent spec row, `[c]` to toggle open-only filter vs all tasks, `[a]` to toggle expand/collapse all, `[e]` to enqueue with confirmation, `[o]` to open in browser, `[p]` to pause/resume, `[k]` to kill worker and wipe worktree, and `[Enter]`/`[i]` to inspect live tail.
- **Telegram Remote Interactive Browser**: Registered `/browse` in bot menu (`BOT_COMMANDS`) and implemented interactive drill-down navigation via inline message editing. Supports spec drill-down views, open-only filter toggling, per-task enqueue buttons, bulk enqueueing (`[⚡ Enqueue All Open Tasks]`), and return navigation (`[⬅️ Back to Tree]`).
