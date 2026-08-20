# imagos

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
