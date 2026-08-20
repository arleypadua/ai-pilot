import { describe, it, expect } from 'vitest';
import { parseIssueDependencies } from '../src/github/parser.js';
import type { GitHubIssue } from '../src/types/index.js';

describe('parseIssueDependencies', () => {
  it('should parse "Blocked by #10" in issue body', () => {
    const issue: GitHubIssue = {
      number: 15,
      title: 'Implement database migrations',
      body: 'We need migrations.\n\nBlocked by #10\nDepends on: #12',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/15',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
    };

    const deps = parseIssueDependencies(issue);
    expect(deps.blockers).toContain(10);
    expect(deps.blockers).toContain(12);
    expect(deps.kind).toBe('standalone');
  });

  it('should parse parent issue references and mark as ticket', () => {
    const issue: GitHubIssue = {
      number: 22,
      title: 'Add JWT auth middleware',
      body: 'Parent: #20\n\nImplement the JWT validator middleware.',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/22',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
    };

    const deps = parseIssueDependencies(issue);
    expect(deps.parentNumber).toBe(20);
    expect(deps.kind).toBe('ticket');
  });

  it('should parse markdown header sections with markdown links like ## Blocked by\\n\\n[#222](url)', () => {
    const issue: GitHubIssue = {
      number: 223,
      title: "Declare the guest's JS surface: shim MessageChannel",
      body: `## Acceptance criteria

- [ ] A guest whose module constructs MessageChannel evaluates

## Blocked by

[#222](https://github.com/wawesomeio/wawesome-monorepo/issues/222) — declaring that gaps "fail loudly" is not true while a module-scope ReferenceError reaches the Tenant as Exited with i32 exit status 1.

## Related

- [#185](https://github.com/wawesomeio/wawesome-monorepo/issues/185)
`,
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/wawesomeio/wawesome-monorepo/issues/223',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
    };

    const deps = parseIssueDependencies(issue);
    expect(deps.blockers).toContain(222);
  });

  it('should parse parent header sections like ## Parent\\n\\n#17', () => {
    const issue: GitHubIssue = {
      number: 35,
      title: 'Follow-up to #31: cross-instance eviction robustness',
      body: `## Parent

#17 — Real-time log streaming & storage for Function invocations

## Context

Follow-up to #31.
`,
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/wawesomeio/wawesome-monorepo/issues/35',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
    };

    const deps = parseIssueDependencies(issue);
    expect(deps.parentNumber).toBe(17);
    expect(deps.kind).toBe('ticket');
  });

  it('should not treat subtasks as blockers when inline Blocked by is used', () => {
    const issue: GitHubIssue = {
      number: 10,
      title: '[Spec] Auth System',
      body: 'Blocked by #5\nSubtasks:\n- [ ] #11\n- [ ] #12',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/10',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
    };

    const deps = parseIssueDependencies(issue);
    expect(deps.blockers).toEqual([5]);
    expect(deps.subTaskNumbers).toEqual([11, 12]);
    expect(deps.kind).toBe('spec');
  });

  it('should parse native GitHub blockedBy, parent, and subIssues', () => {
    const issue: GitHubIssue = {
      number: 187,
      title: 'Spec: Vite/React SSR',
      body: 'No blockers in text',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/187',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
      blockedBy: [
        { number: 186, title: 'Hostname routing', state: 'OPEN' },
        { number: 185, title: 'Feasibility spike', state: 'CLOSED' },
      ],
      subIssues: [
        { number: 195, title: 'Upload static assets', state: 'OPEN' },
        { number: 197, title: 'Storage allowance', state: 'OPEN' },
      ],
    };

    const deps = parseIssueDependencies(issue);
    expect(deps.blockers.sort()).toEqual([185, 186]);
    expect(deps.subTaskNumbers.sort()).toEqual([195, 197]);
    expect(deps.kind).toBe('spec');
  });

  it('should parse native parent relationship and mark as ticket', () => {
    const issue: GitHubIssue = {
      number: 195,
      title: 'Upload static assets',
      body: 'Task body without markdown parent',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/195',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
      parent: { number: 187, title: 'Spec: Vite/React SSR' },
    };

    const deps = parseIssueDependencies(issue);
    expect(deps.parentNumber).toBe(187);
    expect(deps.kind).toBe('ticket');
  });

  it('should merge native GitHub relationships with markdown body relationships', () => {
    const issue: GitHubIssue = {
      number: 50,
      title: 'Task with mixed deps',
      body: 'Blocked by #10\nParent: #100',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/50',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
      blockedBy: [{ number: 20, title: 'Native blocker', state: 'OPEN' }],
      subIssues: [{ number: 51, title: 'Native subtask', state: 'OPEN' }],
    };

    const deps = parseIssueDependencies(issue);
    expect(deps.blockers.sort()).toEqual([10, 20]);
    expect(deps.parentNumber).toBe(100);
    expect(deps.subTaskNumbers).toEqual([51]);
    expect(deps.kind).toBe('ticket');
  });
});
