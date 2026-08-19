# Imagos (🦋 `imagos`)

[![npm version](https://img.shields.io/npm/v/imagos.svg)](https://www.npmjs.com/package/imagos)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**Autonomous, multi-task GitHub issue orchestrator powered by Claude CLI, git worktrees, DAG scheduling, and subscription rolling quota management.**

Named after the biological *imago*—the final, fully formed adult stage emerging from complete metamorphosis—**Imagos** takes raw, grilled specifications and autonomously transforms them into tested, merged pull requests.

Designed to autonomously execute "grilled work" (issues tagged `ready-for-agent` after being refined and grilled for specification clarity) based on the agentic workflow proposed by Matt Pocock on [mattpocock/skills](https://github.com/mattpocock/skills).

---

## ⚡ Instant Usage with `npx`

No global installation required:

```bash
# Initialize in your repository
npx imagos init --repo owner/repo

# Start the autonomous worker daemon
npx imagos start
```

Or install globally:

```bash
npm install -g imagos
# or: pnpm add -g imagos / bun add -g imagos
```

---

## 📋 Prerequisites

Ensure you have authenticated CLIs installed:

1. **GitHub CLI (`gh`)**: Authenticated with repository permissions (`gh auth login`)
2. **Claude CLI (`claude`)**: Authenticated with your Anthropic subscription (`claude`)

---

## 🚀 Quick Start in 3 Steps

### 1. Initialize your repository configuration
Run `imagos init` in the root of your project:
```bash
imagos init --repo owner/repo
```
This creates `.autopilot/config.json`:
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

### 2. Tag grilled issues on GitHub
Refine your tickets and add the `ready-for-agent` label. Imagos supports dependency hierarchies:
```markdown
Parent: #50
Blocked by: #51, #52
```

### 3. Launch the daemon
```bash
imagos start
```
Imagos will start an interactive terminal dashboard, allocate parallel `.autopilot/worktrees/issue-<number>` environments, resolve dependencies in order, and carry tasks through tests, rebase, and auto-merging.

---

## 🛠️ CLI Commands

| Command | Description |
| :--- | :--- |
| `imagos start` | Start the autonomous orchestrator daemon with live terminal dashboard |
| `imagos status` | View the dependency DAG, active sessions, and worktree allocations |
| `imagos inspect <issue>` | Live-stream agent tool calls, modified files, and git diff stat |
| `imagos logs <issue>` | View execution output logs (`stdout` / `stderr`) for a specific issue |
| `imagos resume` | Unpause workers or resume from a quota hold window |
| `imagos clean` | Clean up inactive worktrees, temporary branches, and finished sessions |
| `imagos init` | Generate configuration for the current repository |

---

## 🌟 Key Features

- 🦋 **Specification Metamorphosis (`ready-for-agent`)**: Dispatches agents strictly through the `/implement` skill prompt with full acceptance criteria.
- 🌳 **Dependency-Aware DAG Scheduler**: Automatically parses parent/child relations (`Specs`, `Tickets`, `Standalone`), task checklists (`- [ ] #123`), and blockers (`Blocked by #45`).
- ⚡ **Parallel Git Worktrees**: Spawns isolated `.autopilot/worktrees/issue-<number>` environments up to your configured concurrency limit.
- ⏳ **5-Hour Rolling Quota Protection**: Intercepts Claude Code rate limits in real time, pauses worker processes (`SIGSTOP`), and resumes them once the rolling window opens.
- 💬 **Human Feedback Loop**: Preserves worktree state when an agent needs information (`needs-info`), fires desktop notifications, reacts with `👀` on GitHub, and smoothly resumes with developer feedback once answered.
- 🔀 **Auto-Rebase, PR & Auto-Merge**: Automatically syncs against latest `main`, opens Pull Requests, auto-merges, and cleanly tears down worktrees on completion.

---

## 📖 Canonical Triage Workflow

See [docs/agents/triage-labels.md](file:///Users/arleypadua/repos/agent-auto-pilot/docs/agents/triage-labels.md) for full details on labels and dependency syntax.
