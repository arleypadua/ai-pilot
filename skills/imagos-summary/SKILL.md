---
name: imagos-summary
description: Inspects and summarizes Imagos orchestrator work-in-progress (WIP), active git worktrees, live vs paused agent sessions, quota limits, and items waiting for human review or feedback.
disable-model-invocation: true
user-invocable: true
---

# Imagos Work-in-Progress (WIP) Summary Skill

> **Note:** This skill is **strictly human-invokable only** (`disable-model-invocation: true`). It should only be executed when explicitly triggered by the human user (e.g., via `/imagos-summary`).

Use this skill to provide a clear, structured executive overview of all active, paused, blocked, and pending tasks being orchestrated by **Imagos** (`agent-auto-pilot`).

---

## When to Use This Skill

Activate this workflow when the user explicitly asks:
- _"/imagos-summary"_
- _"What is Imagos working on right now?"_
- _"Give me a summary of current work in progress / active worktrees."_
- _"Are any agent sessions stuck or waiting for review?"_
- _"Check the status of background tasks and runner quotas."_

---

## Step-by-Step Execution Workflow

Follow these steps in order to gather real-time data before composing the summary:

### 1. Check Local Orchestrator & Quota State

Run `imagos status` or inspect local runtime state files:

- **CLI Status:** Run `npx imagos status` or `imagos status` (with `--repo <owner/repo>` if outside the main workspace).
- **State File:** Read `.autopilot/state.json` to check:
  - `daemonStatus` (`running`, `paused_quota`, `idle`, `stopped`).
  - `quotaPausedUntil` (ISO timestamp for quota reset if paused).
  - `activeTasks` (map of issue numbers to active session metadata).
- **Quota Check:** If tasks are paused, check `.autopilot/quota.json` or run `imagos status` to see when the runner quota window resets.

### 2. Inspect Active Worktrees & File Modifications

Check all active git worktrees under `.autopilot/worktrees/`:

- List active worktree directories: `.autopilot/worktrees/issue-<number>/`.
- For each active worktree, check:
  - **Git Status:** Run `git -C .autopilot/worktrees/issue-<number> status --short` to see uncommitted modified/created files.
  - **Diff Summary:** Run `git -C .autopilot/worktrees/issue-<number> diff --stat` or `imagos inspect <number>`.
  - **Recent Agent Activity:** Run `imagos inspect <number>` or inspect `.autopilot/sessions/issue-<number>/stdout.log` (or `~/.claude/projects/`) to see recent tool calls and execution progress.

### 3. Identify Blocked and Pending Issues

Run `imagos backlog --json` or `imagos backlog` to categorize open issues:

- **Ready for Agent (`ready-for-agent`):** Unblocked tasks waiting for an available worker slot.
- **Pending on Human (`needs-info` or `ready-for-human`):**
  - For `needs-info`: Run `gh issue view <number> --json comments,body` to extract the exact question the agent asked in the issue comments.
  - For `ready-for-human`: Run `gh pr view <branch> --json title,body,reviews,statusCheckRollup,url` or `gh issue view <number>` to determine why human review is needed (e.g. CI check failures, manual review required, `autoMerge` disabled).
- **Blocked by Dependencies:** Identify which blocker issues (#X, #Y) must complete before downstream tasks can start.

---

## Response Output Template

Format your summary as a clean Executive Dashboard in Markdown:

```markdown
# 🚀 Imagos Work-in-Progress (WIP) Summary

**Repository:** `<owner/repo>` | **Daemon Status:** `🟢 Running` (or `⏸️ Paused (Quota)`) | **Active Workers:** `X / Max Y`

---

### 🟢 Active & Live Sessions

- **Issue #<number>: <Title>**
  - **Runner:** `<claude | agy>` | **Branch:** `agent/issue-<number>`
  - **Current Activity:** `<Brief 1-sentence summary of what the agent is currently doing / last tool call>`
  - **Modified Files:** `<e.g. src/auth/jwt.ts, tests/auth.test.ts (+45/-12)>`
  - **Worktree:** `.autopilot/worktrees/issue-<number>`

_(If no active sessions, output: "No tasks are currently executing.")_

---

### ⏸️ Paused & Blocked Tasks

- **Issue #<number>: <Title>**
  - **Reason:** `⏳ Blocked by #<blockerNumber>` _(Waiting for #<blockerNumber> to be merged)_
- **Runner Quota:** `⏸️ Quota limit reached for <runner>. Automatic wake-up scheduled at <timestamp> (in Xm).`

_(If none, output: "No tasks are blocked or paused.")_

---

### 🔍 Waiting for Human Review / Feedback

- **Issue #<number>: <Title>** (`needs-info` | `ready-for-human`)
  - **Why it is waiting:** `<Clear explanation of the agent's question or reason for human review>`
  - **Links:** [Issue #<number>](url) | [PR #<prNumber>](prUrl)
  - **Required Action:** `<e.g. Reply to comment regarding database migration strategy, or review and merge PR #<prNumber>>`

_(If none, output: "No issues currently require human feedback.")_

---

### 📋 Recommended Next Steps

1. `<Immediate action 1, e.g. "Review PR #42 to unblock child issue #43">`
2. `<Immediate action 2, e.g. "Answer the clarification question on Issue #38">`
3. `<Optional CLI command, e.g. "Run 'imagos resume' if you wish to bypass quota limits manually">`
```

---

## Troubleshooting & Tips

- If `imagos status` returns no active daemon, inform the user that the daemon is stopped and can be started with `imagos start` or `imagos start --no-interactive`.
- Always verify with `gh` CLI if GitHub tokens are configured; if `gh` is unauthenticated, fallback to reading `.autopilot/` local metadata files.
- If the folder `.autopilot/` doesn't exist along with the `config.json` file, it is likely that imagos has not been initialized in this repository/workspace. Prompt the user to init it with `npx imagos@latest init`
