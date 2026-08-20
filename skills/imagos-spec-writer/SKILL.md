---
name: imagos-spec-writer
description: Helps users write, decompose, and create GitHub issues and specs formatted for Imagos (agent-auto-pilot) with native GitHub relationships (sub-issues, parent specs, blockers) and canonical queue labels (needs-triage, ready-for-agent). Automatically detects mattpocock/skills for heavy spec breakdowns or performs fast ad-hoc ticket creation.
disable-model-invocation: true
user-invocable: true
---

# Imagos Spec & Ticket Writer Skill

> **Note:** This skill is **strictly human-invokable only** (`disable-model-invocation: true`). It should only be executed when explicitly triggered by the human user (e.g., via `/imagos-spec-writer`).

Use this skill to help developers write, refine, and create GitHub issues and specs formatted specifically for autonomous multi-agent execution with **Imagos** (`agent-auto-pilot`).

---

## When to Use This Skill

Activate this workflow when the user explicitly asks:
- *"/imagos-spec-writer"*
- *"Write a spec for [feature]."*
- *"Break down this task into tickets for Imagos."*
- *"Create an issue / ticket for this bug or requirement."*
- *"Help me structure GitHub issues with dependencies and acceptance criteria."*

---

## Step 1: Assess Task Complexity & Check for Existing Skills

1. **Check for `mattpocock/skills`:**
   - Check if skills like `grill-me`, `to-spec`, or `to-tickets` are available in the current environment (e.g. `.claude/skills/`, `.agents/skills/`, or agent skill registry).
2. **Determine Workflow Path:**
   - **Large Feature / Epic / Spec:**
     - If `mattpocock/skills` are installed: Recommend or leverage the `/grill-me` ➔ `/to-spec` ➔ `/to-tickets` flow, ensuring the generated tickets follow Imagos DAG formatting.
     - If not installed: Ask 2–4 targeted architectural clarifying questions to establish requirements before drafting the spec.
   - **Small / Ad-hoc Task or Bug:**
     - Skip heavy grilling. Immediately proceed to drafting a single focused ticket with concrete acceptance criteria and dependency tags.

---

## Step 2: Format Issues for Imagos DAG Parsing

Imagos automatically parses dependencies from GitHub issues. Structure every issue according to these rules:

### A. Parent Spec Issues (Epics / Specs)
- **Title:** `[Spec] <Feature Name>`
- **Labels:** `needs-triage` (default draft mode)
- **Body Format:**
  ```markdown
  # [Spec] Feature Name

  ## Overview & Goal
  <High-level summary of what is being built and why>

  ## Architecture & Design Decisions
  - <Key architectural choices, APIs, or database schema changes>

  ## Acceptance Criteria
  - [ ] All child subtasks implemented and passing tests
  - [ ] Linting and type checks pass cleanly (`pnpm build`, `pnpm test`)

  ## Subtasks
  - [ ] #<child1> — <Child 1 title>
  - [ ] #<child2> — <Child 2 title>
  ```

### B. Child Ticket Issues (Executable Tasks)
- **Title:** `<Action Verb> <Component or Feature>` (e.g. `Implement JWT Refresh Token Endpoint`)
- **Labels:** `needs-triage` (default draft mode)
- **Body Format:**
  ```markdown
  Parent: #<parentSpecNumber>
  Blocked by: #<prerequisiteIssueNumber>

  ## Context & Objective
  <What needs to be implemented and which files/directories are involved>

  ## Requirements & Acceptance Criteria
  - [ ] <Concrete testable condition 1, e.g. "POST /api/auth/refresh returns 200 with new JWT">
  - [ ] <Concrete testable condition 2, e.g. "Returns 401 on expired refresh token">
  - [ ] <Test requirement, e.g. "Unit tests added in tests/auth.test.ts passing via pnpm test">

  ## Implementation Hints / Target Files
  - `src/auth/token.ts`
  - `src/routes/auth.ts`
  ```

---

## Step 3: Interactive Preview & Confirmation

1. **Present the Draft to the User:**
   - Display the complete hierarchy (Parent spec + child tickets, with blockers and titles).
   - Show the exact markdown body that will be posted to GitHub.
2. **Ask for Confirmation:**
   - Confirm whether the user wants to adjust titles, acceptance criteria, or blockers before creating them on GitHub.

---

## Step 4: Create Issues via GitHub CLI (`gh`)

Once confirmed, execute `gh` commands in the repository:

1. **Create the Parent Spec (if applicable):**
   ```bash
   gh issue create \
     --title "[Spec] Feature Name" \
     --body "<spec body without subtasks initially>" \
     --label "needs-triage"
   ```
   *(Note the created issue number, e.g., `#50`)*

2. **Create the Child Tickets:**
   ```bash
   gh issue create \
     --title "Implement Core Feature Part 1" \
     --body "Parent: #50\n\n## Context\n...\n\n## Acceptance Criteria\n- [ ] ..." \
     --label "needs-triage"

   gh issue create \
     --title "Implement Feature Part 2 (Blocked by Part 1)" \
     --body "Parent: #50\nBlocked by: #51\n\n## Context\n...\n\n## Acceptance Criteria\n- [ ] ..." \
     --label "needs-triage"
   ```

3. **Link Subtasks in the Parent Spec:**
   Update the parent issue with the subtask checklist:
   ```bash
   gh issue edit 50 --body "<updated body with '- [ ] #51\n- [ ] #52'>"
   ```

---

## Step 5: Activation & Labeling

After creation:
1. Provide the URLs to all created issues and summarize the dependency DAG.
2. **Ask the User:**
   > *"The issues have been created with `needs-triage` (draft mode). Are you ready to queue them for autonomous execution by tagging `ready-for-agent`?"*
3. If confirmed, apply `ready-for-agent` to the unblocked ready tickets:
   ```bash
   gh issue edit <issueNumber> --add-label "ready-for-agent"
   ```
