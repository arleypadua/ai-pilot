# Imagos (🦋 `imagos`)

Autonomous, multi-task GitHub issue orchestrator powered by Claude CLI, git worktrees, DAG scheduling, and subscription rolling quota management.

Named after the biological *imago*—the final, fully formed adult stage emerging from complete metamorphosis—**Imagos** takes raw, grilled specifications and autonomously transforms them into tested, merged pull requests.

Designed to autonomously execute "grilled work" (issues tagged `ready-for-agent` after being refined and grilled for specification clarity) based on the agentic workflow proposed by Matt Pocock on [mattpocock/skills](https://github.com/mattpocock/skills).

---

## Key Features

- 🦋 **Specification Metamorphosis (`ready-for-agent`)**: Picks up thoroughly grilled and specified issues, invoking the `/implement` skill directly with full context.
- 🌳 **Dependency-Aware DAG Scheduler**: Automatically parses parent/child relations (`Specs`, `Tickets`, `Standalone`), task checklists (`- [ ] #123`), and blockers (`Blocked by #45`).
- ⚡ **Parallel Git Worktrees**: Spawns isolated `.autopilot/worktrees/issue-<number>` cocoon environments up to your configured concurrency limit.
- ⏳ **5-Hour Rolling Quota Protection**: Intercepts Claude Code rate-limit patterns in real time, automatically suspends worker processes (`SIGSTOP`), and resumes them once the rolling window opens up.
- 💬 **Human Feedback Loop & Session Continuation**: Preserves worktree state when an agent needs information (`needs-info`), fires desktop notifications, and smoothly resumes with developer feedback once answered on GitHub.
- 🔀 **Auto-Rebase, PR & Auto-Merge**: Automatically syncs against latest `main`, opens Pull Requests, auto-merges, and cleanly tears down worktrees on completion.

---

## Installation & Setup

```bash
# Global install via npm / pnpm
npm install -g imagos
# or run directly with npx
npx imagos --help

# Or install from source
git clone https://github.com/arleypadua/ai-pilot.git
cd ai-pilot
pnpm install
pnpm run build
pnpm link --global
```

Ensure you have:
1. `gh` CLI authenticated (`gh auth login`)
2. `claude` CLI authenticated (`claude`)

---

## Quick Start

### 1. Initialize configuration for your repository
```bash
imagos init --repo owner/repo
```

This generates `autopilot.config.json`:
```json
{
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

### 2. Start the autonomous daemon
```bash
imagos start
```

### 3. Check current DAG status & active worktrees
```bash
imagos status
```

### 4. Clean up inactive worktrees and branches
```bash
imagos clean
```

---

## Canonical Triage Workflow

Based on the [mattpocock/skills](https://github.com/mattpocock/skills) workflow, issues undergo thorough specification and grilling before being marked with `ready-for-agent`. Once labeled, Imagos picks them up for execution.

See [docs/agents/triage-labels.md](file:///Users/arleypadua/repos/agent-auto-pilot/docs/agents/triage-labels.md) for full details on labels and dependency syntax.
