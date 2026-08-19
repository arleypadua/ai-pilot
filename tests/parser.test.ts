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

  it('should identify spec issues with child checklists', () => {
    const issue: GitHubIssue = {
      number: 50,
      title: '[Spec] Authentication and User Management System',
      body: `## Acceptance Criteria
- Support JWT auth
- Password hashing

### Subtasks
- [ ] #51
- [ ] #52
- [x] #53
`,
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/50',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
    };

    const deps = parseIssueDependencies(issue);
    expect(deps.kind).toBe('spec');
    expect(deps.subTaskNumbers).toEqual([51, 52, 53]);
  });
});
