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

  it('should scope execution strictly to a target spec and detect completion', () => {
    const issues: GitHubIssue[] = [
      {
        number: 50,
        title: '[Spec] User Billing Flow',
        body: 'Subtasks:\n- [ ] #51\n- [ ] #52',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/50',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 51,
        title: 'Stripe webhook handler',
        body: 'Parent: #50',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/51',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 52,
        title: 'Invoice PDF generator',
        body: 'Parent: #50',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/52',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 99,
        title: 'Unrelated Standalone Bugfix',
        body: 'Fix css style',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/99',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG({ ...DEFAULT_CONFIG, targetSpec: 50 });
    dag.build(issues);

    const readyNodes = dag.getReadyNodes();
    // Only #51 and #52 belong to spec 50; #99 is filtered out
    expect(readyNodes.map((n) => n.issue.number).sort()).toEqual([51, 52]);

    const initialCheck = dag.isSpecComplete(50);
    expect(initialCheck.isComplete).toBe(false);
    expect(initialCheck.totalTickets).toBe(2);

    // Simulate closing both tickets
    issues[1].state = 'CLOSED';
    issues[2].state = 'CLOSED';
    dag.build(issues);

    const completeCheck = dag.isSpecComplete(50);
    expect(completeCheck.isComplete).toBe(true);
    expect(completeCheck.completedTickets).toBe(2);
    expect(completeCheck.pendingTickets).toEqual([]);
  });
});
