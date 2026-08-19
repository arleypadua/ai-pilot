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
});
