import { describe, it, expect } from 'vitest';
import { IssueDAG } from '../src/github/dag.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';
import type { GitHubIssue } from '../src/types/index.js';

describe('IssueDAG', () => {
  it('should correctly determine ready vs blocked tasks', () => {
    const issues: GitHubIssue[] = [
      {
        number: 1,
        title: 'Initial Database Schema',
        body: 'Create tables',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/1',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 2,
        title: 'Add User API Endpoint',
        body: 'Depends on: #1',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/2',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG(DEFAULT_CONFIG);
    dag.build(issues);

    const readyNodes = dag.getReadyNodes();
    const blockedNodes = dag.getBlockedNodes();

    expect(readyNodes.map((n) => n.issue.number)).toEqual([1]);
    expect(blockedNodes.map((n) => n.issue.number)).toEqual([2]);
    expect(dag.getUnresolvedBlockers(2)).toEqual([1]);
  });

  it('should unlock dependent task once blocker is closed', () => {
    const issues: GitHubIssue[] = [
      {
        number: 1,
        title: 'Initial Database Schema',
        body: 'Create tables',
        state: 'CLOSED',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/1',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 2,
        title: 'Add User API Endpoint',
        body: 'Blocked by #1',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/2',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG(DEFAULT_CONFIG);
    dag.build(issues);

    const readyNodes = dag.getReadyNodes();
    expect(readyNodes.map((n) => n.issue.number)).toEqual([2]);
  });

  it('should mark tasks with needs-info as waiting_feedback', () => {
    const issues: GitHubIssue[] = [
      {
        number: 3,
        title: 'Configure OAuth Provider',
        body: 'Which provider should we use?',
        state: 'OPEN',
        labels: [{ name: 'needs-info' }],
        url: 'https://github.com/owner/repo/issues/3',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG(DEFAULT_CONFIG);
    dag.build(issues);

    const feedbackNodes = dag.getWaitingFeedbackNodes();
    expect(feedbackNodes.map((n) => n.issue.number)).toEqual([3]);
  });
});
