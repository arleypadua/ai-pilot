import { describe, it, expect } from 'vitest';
import { IssueDAG } from '../src/github/dag.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';
import { parseSpecsOption } from '../src/cli.js';
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

  it('should scope execution to multiple target specs', () => {
    const issues: GitHubIssue[] = [
      {
        number: 10,
        title: '[Spec] Auth Flow',
        body: 'Subtasks:\n- [ ] #11\n- [ ] #12',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/10',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 11,
        title: 'Auth Login',
        body: 'Parent: #10',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/11',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 12,
        title: 'Auth Logout',
        body: 'Parent: #10',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/12',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 20,
        title: '[Spec] Payment Flow',
        body: 'Subtasks:\n- [ ] #21',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/20',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 21,
        title: 'Credit Card Charge',
        body: 'Parent: #20\nBlocked by: #11',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/21',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 99,
        title: 'Unrelated Standalone Task',
        body: 'Do something else',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/99',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG({ ...DEFAULT_CONFIG, targetSpecs: [10, 20] });
    dag.build(issues);

    expect(dag.getTargetSpecs()).toEqual([10, 20]);

    const readyNodes = dag.getReadyNodes();
    // #11 and #12 are ready and belong to Spec 10; #21 is blocked by #11 (belongs to Spec 20); #99 is ignored
    expect(readyNodes.map((n) => n.issue.number).sort()).toEqual([11, 12]);

    const blockedNodes = dag.getBlockedNodes();
    expect(blockedNodes.map((n) => n.issue.number)).toEqual([21]);
  });

  it('should support targetSpec as an array in config', () => {
    const issues: GitHubIssue[] = [
      {
        number: 30,
        title: '[Spec] Spec A',
        body: 'Subtasks:\n- [ ] #31',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/30',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 31,
        title: 'Task A1',
        body: 'Parent: #30',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/31',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 40,
        title: '[Spec] Spec B',
        body: 'Subtasks:\n- [ ] #41',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/40',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 41,
        title: 'Task B1',
        body: 'Parent: #40',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/41',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG({ ...DEFAULT_CONFIG, targetSpec: [30, 40] });
    dag.build(issues);

    expect(dag.getTargetSpecs()).toEqual([30, 40]);
    const readyNodes = dag.getReadyNodes();
    expect(readyNodes.map((n) => n.issue.number).sort()).toEqual([31, 41]);
  });

  it('should detect completion for each spec independently when multiple specs exist', () => {
    const issues: GitHubIssue[] = [
      {
        number: 100,
        title: '[Spec] Feature 1',
        body: 'Subtasks:\n- [ ] #101',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/100',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 101,
        title: 'Task 1.1',
        body: 'Parent: #100',
        state: 'CLOSED',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/101',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 200,
        title: '[Spec] Feature 2',
        body: 'Subtasks:\n- [ ] #201',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/200',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 201,
        title: 'Task 2.1',
        body: 'Parent: #200',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/201',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG({ ...DEFAULT_CONFIG, targetSpecs: [100, 200] });
    dag.build(issues);

    expect(dag.isSpecComplete(100).isComplete).toBe(true);
    expect(dag.isSpecComplete(200).isComplete).toBe(false);
  });
});

describe('parseSpecsOption', () => {
  it('should parse single string number', () => {
    expect(parseSpecsOption('42')).toEqual([42]);
  });

  it('should parse comma-separated string numbers', () => {
    expect(parseSpecsOption('10, 20, 30')).toEqual([10, 20, 30]);
  });

  it('should accumulate values across multiple invocations and ignore non-numbers', () => {
    const prev = parseSpecsOption('10,20');
    const result = parseSpecsOption('30,invalid,40', prev);
    expect(result).toEqual([10, 20, 30, 40]);
  });

  it('should handle array inputs from variadic options', () => {
    expect(parseSpecsOption(['50', '60,70'])).toEqual([50, 60, 70]);
  });
});


