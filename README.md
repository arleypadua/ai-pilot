# imagos

[![npm version](https://img.shields.io/npm/v/imagos.svg)](https://www.npmjs.com/package/imagos)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Autonomous multi-task GitHub issue orchestrator powered by Claude CLI, git worktrees, and DAG dependency scheduling.

`imagos` runs as a local background daemon. It monitors your GitHub issue backlog for tasks tagged `ready-for-agent`, builds a dependency graph, and runs isolated git worktrees in parallel to implement, test, and merge pull requests automatically.

Based on the agentic workflow proposed by Matt Pocock on [mattpocock/skills](https://github.com/mattpocock/skills), where issues are refined and grilled for clarity before being handed off to agents.

---

## Quick Start

Run directly with `npx`:

```bash
# 1. Initialize configuration for your repository
npx imagos init --repo owner/repo

# 2. Start the daemon
npx imagos start
```

Or install globally:

```bash
pnpm add -g imagos
# or: npm install -g imagos / bun add -g imagos
```

---

## Prerequisites

Before running `imagos`, ensure the required CLIs are installed and authenticated:

- **GitHub CLI (`gh`)**: `gh auth login`
- **Claude CLI (`claude`)**: Run `claude` and complete login

---

## How It Works

1. **Refine issues**: Add acceptance criteria on GitHub and set dependencies (`Parent: #50`, `Blocked by: #51`).
2. **Tag `ready-for-agent`**: Apply the `ready-for-agent` label to unblocked issues.
3. **Daemon execution**: `imagos` picks up ready tasks, spins up isolated worktrees (`.autopilot/worktrees/issue-<number>`), runs `/implement`, executes tests, and opens PRs.
4. **Human feedback loop**: If the agent gets stuck, it posts a question on the issue, adds `needs-info`, and pauses. Once you reply and re-add `ready-for-agent`, `imagos` resumes the task with your answer.
5. **Auto-merge**: When tests pass, `imagos` rebases onto `main`, merges the PR, closes the issue, and cleans up the worktree.

---

## Scoping to Specific Specs

You can restrict execution to child tickets of one or more specification issues:

```bash
# Single spec
imagos start -s 50

# Multiple specs (comma-separated or repeated)
imagos start -s 50,51
imagos start --specs 50 51
imagos start -s 50 -s 51
```

You can also scope `status` and `backlog` inspections:

```bash
imagos status -s 50,51
imagos backlog -s 50,51 --ready
```

---

## CLI Commands

| Command | Description |
| :--- | :--- |
| `imagos start` | Start the autonomous daemon and live terminal dashboard |
| `imagos status` | Show current issue DAG, active sessions, and worktree allocations |
| `imagos backlog` | Filter and inspect the issue queue (`--ready`, `--pending`, `--blocked`) |
| `imagos inspect <issue>` | Live stream tool calls, modified files, and diff stat for an active task |
| `imagos logs <issue>` | View stdout/stderr output for a specific task |
| `imagos resume` | Unpause workers after quota reset or clear a paused state |
| `imagos clean` | Remove inactive worktrees, temporary branches, and finished sessions |
| `imagos init` | Generate `.autopilot/config.json` for the current repository |

---

## Configuration

`imagos init` creates `.autopilot/config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/arleypadua/imagos/main/schema.json",
  "repository": "owner/repo",
  "targetSpecs": [50, 51],
  "baseBranch": "main",
  "maxConcurrency": 2,
  "pollIntervalSeconds": 30,
  "extraPrompt": "",
  "runner": "claude",
  "autoMerge": true,
  "mergeMethod": "squash",
  "cleanupWorktreeOnClose": true,
  "quota": {
    "pauseOnLimit": true,
    "utilizationThreshold": 0.95
  },
  "labels": {
    "readyForAgent": "ready-for-agent",
    "needsInfo": "needs-info",
    "readyForHuman": "ready-for-human",
    "needsTriage": "needs-triage",
    "wontfix": "wontfix"
  }
}
```

---

## Workflow Guide

See [docs/agents/triage-labels.md](docs/agents/triage-labels.md) for label definitions and dependency syntax.
