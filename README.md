# Agent Auto-Pilot (⚡ `agent-autopilot`)

Autonomous, multi-task GitHub issue orchestrator powered by Claude CLI, git worktrees, DAG scheduling, and subscription rolling quota management.

---

## Key Features

- 🌳 **Dependency-Aware DAG Scheduler**: Automatically parses parent/child relations (`Specs`, `Tickets`, `Standalone`), task checklists (`- [ ] #123`), and blockers (`Blocked by #45`).
- ⚡ **Parallel Git Worktrees**: Spawns isolated `.autopilot/worktrees/issue-<number>` environments up to your configured concurrency limit.
- 🎯 **Strict `/implement` Skill Invocation**: Dispatches agents strictly through the `/implement` skill prompt with full acceptance criteria and issue context.
- ⏳ **5-Hour Rolling Quota Protection**: Intercepts Claude Code rate-limit patterns in real time, automatically suspends worker processes (`SIGSTOP`), and resumes them once the rolling window opens up.
- 💬 **Human Feedback Loop & Session Continuation**: Preserves worktree state when an agent needs information (`needs-info`), fires desktop notifications, and smoothly resumes with developer feedback once answered on GitHub.
- 🔀 **Auto-Rebase, Testing, PR & Auto-Merge**: Automatically syncs against latest `main`, runs test suites, opens Pull Requests, auto-merges, and cleanly tears down worktrees on completion.

---

## Installation & Setup

```bash
# Clone and install dependencies
git clone <your-repo>
cd agent-auto-pilot
pnpm install
pnpm run build

# Link globally or run directly
pnpm link --global
```

Ensure you have:
1. `gh` CLI authenticated (`gh auth login`)
2. `claude` CLI authenticated (`claude`)

---

## Quick Start

### 1. Initialize configuration for your repository
```bash
agent-autopilot init --repo owner/repo
```

This generates `autopilot.config.json`:
```json
{
  "repository": "owner/repo",
  "baseBranch": "main",
  "maxConcurrency": 2,
  "pollIntervalSeconds": 30,
  "runner": "claude",
  "testCommand": "npm test",
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

### 2. Start the autonomous daemon
```bash
agent-autopilot start
```

### 3. Check current DAG status & active worktrees
```bash
agent-autopilot status
```

### 4. Clean up inactive worktrees and branches
```bash
agent-autopilot clean
```

---

## Canonical Triage Workflow

See [docs/agents/triage-labels.md](file:///Users/arleypadua/repos/agent-auto-pilot/docs/agents/triage-labels.md) for full details on labels and dependency syntax.
