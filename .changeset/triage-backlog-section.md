---
"imagos": minor
---

feat: add triage backlog section under Issue DAG Queue

- **Issue DAG Queue Triage Section**: Added a dedicated `📋 Needs Triage:` section in the Master Dashboard TUI and CLI table overview to view untriaged open issues (`needs-triage`).
- **Interactive Backlog Drill-down**: Enabled selecting and inspecting the triage backlog in the interactive Category Issues View (press Enter on Needs Triage row), displaying the `📋 needs triage` status badge and supporting actions to enqueue, inspect, or open issues in browser.
- **DAG Triage Queries**: Added `getTriageNodes()` to `IssueDAG` returning open un-triaged tasks and respecting spec scope.
