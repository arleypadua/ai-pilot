# imagos

[![npm version](https://img.shields.io/npm/v/imagos.svg)](https://www.npmjs.com/package/imagos)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Autonomous multi-task GitHub issue orchestrator powered by Claude CLI, git worktrees, and DAG dependency scheduling.

`imagos` runs as a local background daemon. It monitors your GitHub issue backlog for tasks tagged `ready-for-agent`, builds a dependency graph (DAG), and spins up parallel isolated git worktrees to implement, test, and merge pull requests automatically.

Based on the agentic workflow proposed by Matt Pocock on [mattpocock/skills](https://github.com/mattpocock/skills), where issues are refined and grilled for clarity before being handed off to agents.

---

## Quick Start

Run directly with `npx` (no installation required):

```bash
# 1. Initialize configuration for your repository
npx imagos init --repo owner/repo

# 2. Start the daemon
npx imagos start
```

Or install globally:

```bash
npm install -g imagos
# or: pnpm add -g imagos / bun add -g imagos
```

---

## Prerequisites

Before running `imagos`, make sure both CLIs are installed and authenticated:

- **GitHub CLI (`gh`)**: `gh auth login`
- **Claude CLI (`claude`)**: Run `claude` and complete the login prompt

---

## How It Works

1. **Refine issues**: Write acceptance criteria on GitHub and add dependencies if needed (`Parent: #50`, `Blocked by: #51`).
2. **Tag `ready-for-agent`**: Mark refined issues with the `ready-for-agent` label.
3. **Daemon takes over**: `imagos` picks up unblocked tasks, allocates isolated worktrees (`.autopilot/worktrees/issue-<number>`), runs the `/implement` prompt, executes tests, and opens PRs.
4. **Human feedback**: If an agent gets blocked, it posts a question on the issue, adds `needs-info`, and pauses. Once you reply and re-add `ready-for-agent`, `imagos` resumes the session with your feedback.
5. **Auto-merge**: Once tests pass, `imagos` rebases onto `main`, merges the PR, closes the issue, and cleans up the worktree.

---

## CLI Commands

| Command | Description |
| :--- | :--- |
| `imagos start` | Start the autonomous daemon and live terminal dashboard |
| `imagos status` | Show current issue DAG, active sessions, and worktree allocations |
| `imagos inspect <issue>` | Live stream agent tool calls, modified files, and diff stat |
| `imagos logs <issue>` | View stdout/stderr logs for a specific task |
| `imagos resume` | Unpause workers or resume from a quota window |
| `imagos clean` | Remove inactive worktrees, temporary branches, and finished sessions |
| `imagos init` | Generate configuration file for the current project |

---

## Configuration

`imagos init` creates `.autopilot/config.json` in your repository root:

```json
{
  "$schema": "https://raw.githubusercontent.com/arleypadua/imagos/main/schema.json",
  "repository": "owner/repo",
  "baseBranch": "main",
  "maxConcurrency": 2,
  "pollIntervalSeconds": 30,
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

See [docs/agents/triage-labels.md](file:///Users/arleypadua/repos/agent-auto-pilot/docs/agents/triage-labels.md) for label definitions and dependency syntax.
