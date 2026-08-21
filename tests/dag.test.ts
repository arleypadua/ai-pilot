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

  it('should mark tasks with needs-info, ready-for-human, or human-task as waiting_feedback', () => {
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
      {
        number: 4,
        title: 'PR Open for Review',
        body: 'Implemented but unmerged',
        state: 'OPEN',
        labels: [{ name: 'ready-for-human' }],
        url: 'https://github.com/owner/repo/issues/4',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 5,
        title: 'Manual 2FA hardware key setup',
        body: 'Must be done manually by admin',
        state: 'OPEN',
        labels: [{ name: 'human-task' }],
        url: 'https://github.com/owner/repo/issues/5',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG(DEFAULT_CONFIG);
    dag.build(issues);

    const feedbackNodes = dag.getWaitingFeedbackNodes();
    expect(feedbackNodes.map((n) => n.issue.number).sort()).toEqual([3, 4, 5]);
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

  it('should prune closed and completed specs from targetSpecs', () => {
    const issues: GitHubIssue[] = [
      {
        number: 100,
        title: '[Spec] Feature 1 (Done)',
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
        title: '[Spec] Feature 2 (In progress)',
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
      {
        number: 300,
        title: '[Spec] Feature 3 (Closed issue)',
        body: 'Subtasks:\n- [ ] #301',
        state: 'CLOSED',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/300',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 301,
        title: 'Task 3.1',
        body: 'Parent: #300',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/301',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG({ ...DEFAULT_CONFIG, targetSpecs: [100, 200, 300] });
    dag.build(issues);

    const result = dag.pruneCompletedTargetSpecs();
    expect(result.removed.sort()).toEqual([100, 300]);
    expect(result.remaining).toEqual([200]);
    expect(dag.getTargetSpecs()).toEqual([200]);

    // Close #201 and prune again
    issues[3].state = 'CLOSED';
    dag.build(issues);

    const result2 = dag.pruneCompletedTargetSpecs();
    expect(result2.removed).toEqual([200]);
    expect(result2.remaining).toEqual([]);
    expect(dag.getTargetSpecs()).toEqual([]);
  });

  it('should mark all children of a spec as blocked if the spec is blocked by another ticket', () => {
    const issues: GitHubIssue[] = [
      {
        number: 5,
        title: 'Core Infrastructure Setup',
        body: 'Set up base VPC and DB',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/5',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 10,
        title: '[Spec] Auth System',
        body: 'Blocked by #5\nSubtasks:\n- [ ] #11\n- [ ] #12',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/10',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 11,
        title: 'Login endpoint',
        body: 'Parent: #10',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/11',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 12,
        title: 'Register endpoint',
        body: 'Parent: #10',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/12',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG(DEFAULT_CONFIG);
    dag.build(issues);

    const readyNodes = dag.getReadyNodes();
    const blockedNodes = dag.getBlockedNodes();

    // #5 is ready; #10, #11, #12 are blocked
    expect(readyNodes.map((n) => n.issue.number)).toEqual([5]);
    expect(blockedNodes.map((n) => n.issue.number).sort()).toEqual([10, 11, 12]);

    // Children inherit #5 in their blocker list and unresolved blockers
    const node11 = dag.getNode(11);
    const node12 = dag.getNode(12);
    expect(node11?.blockers).toContain(5);
    expect(node12?.blockers).toContain(5);
    expect(dag.getUnresolvedBlockers(11)).toEqual([5]);
    expect(dag.getUnresolvedBlockers(12)).toEqual([5]);

    // Blocker #5 has dependents [10, 11, 12]
    const blockerNode = dag.getNode(5);
    expect(blockerNode?.dependents.sort()).toEqual([10, 11, 12]);
  });

  it('should unblock spec children when the blocker ticket is closed', () => {
    const issues: GitHubIssue[] = [
      {
        number: 5,
        title: 'Core Infrastructure Setup',
        body: 'Set up base VPC and DB',
        state: 'CLOSED',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/5',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 10,
        title: '[Spec] Auth System',
        body: 'Blocked by #5\nSubtasks:\n- [ ] #11\n- [ ] #12',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/10',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 11,
        title: 'Login endpoint',
        body: 'Parent: #10',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/11',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 12,
        title: 'Register endpoint',
        body: 'Parent: #10',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/12',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG(DEFAULT_CONFIG);
    dag.build(issues);

    const readyNodes = dag.getReadyNodes();
    expect(readyNodes.map((n) => n.issue.number).sort()).toEqual([10, 11, 12]);
    expect(dag.getBlockedNodes()).toEqual([]);
  });

  it('should combine direct blockers and parent spec blockers on a child ticket', () => {
    const issues: GitHubIssue[] = [
      {
        number: 5,
        title: 'Spec Blocker',
        body: 'Spec blocker issue',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/5',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 7,
        title: 'Child Direct Blocker',
        body: 'Direct blocker issue',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/7',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 10,
        title: '[Spec] Feature',
        body: 'Blocked by #5\nSubtasks:\n- [ ] #11',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/10',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 11,
        title: 'Feature Task',
        body: 'Parent: #10\nBlocked by #7',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/11',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG(DEFAULT_CONFIG);
    dag.build(issues);

    const node11 = dag.getNode(11);
    expect(node11?.blockers.sort()).toEqual([5, 7]);
    expect(dag.getUnresolvedBlockers(11).sort()).toEqual([5, 7]);
    expect(node11?.status).toBe('blocked');

    // Close only spec blocker #5: #11 still blocked by #7
    issues[0].state = 'CLOSED';
    dag.build(issues);
    expect(dag.getNode(11)?.status).toBe('blocked');
    expect(dag.getUnresolvedBlockers(11)).toEqual([7]);

    // Close direct blocker #7: #11 is now ready
    issues[1].state = 'CLOSED';
    dag.build(issues);
    expect(dag.getNode(11)?.status).toBe('ready');
    expect(dag.getUnresolvedBlockers(11)).toEqual([]);
  });

  it('should recursively inherit blockers through nested spec hierarchies', () => {
    const issues: GitHubIssue[] = [
      {
        number: 1,
        title: 'Epic Blocker',
        body: 'Blocks root epic',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/1',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 2,
        title: 'Sub-spec Blocker',
        body: 'Blocks sub-spec',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/2',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 10,
        title: '[Spec] Root Epic',
        body: 'Blocked by #1\nSubtasks:\n- [ ] #20',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/10',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 20,
        title: '[Spec] Sub Spec',
        body: 'Parent: #10\nBlocked by #2\nSubtasks:\n- [ ] #30',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/20',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 30,
        title: 'Leaf Task',
        body: 'Parent: #20',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/30',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const dag = new IssueDAG(DEFAULT_CONFIG);
    dag.build(issues);

    const leafNode = dag.getNode(30);
    // Leaf node #30 inherits blocker #2 from parent spec #20 and #1 from grandparent spec #10
    expect(leafNode?.blockers.sort()).toEqual([1, 2]);
    expect(leafNode?.status).toBe('blocked');
    expect(dag.getUnresolvedBlockers(30).sort()).toEqual([1, 2]);
  });

  it('should block spec and its children when spec has native GitHub blockedBy', () => {
    const issues: GitHubIssue[] = [
      {
        number: 186,
        title: 'Spec: Hostname routing',
        body: 'Hostname routing spec',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/186',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 187,
        title: 'Spec: Vite/React SSR',
        body: 'No blockers in text',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/187',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
        blockedBy: [{ number: 186, title: 'Spec: Hostname routing', state: 'OPEN' }],
        subIssues: [{ number: 195, title: 'Upload static assets', state: 'OPEN' }],
      },
      {
        number: 195,
        title: 'Upload static assets',
        body: 'Subtask body',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/195',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
        parent: { number: 187, title: 'Spec: Vite/React SSR' },
      },
    ];

    const dag = new IssueDAG(DEFAULT_CONFIG);
    dag.build(issues);

    const specNode = dag.getNode(187);
    const childNode = dag.getNode(195);

    expect(specNode?.status).toBe('blocked');
    expect(specNode?.blockers).toContain(186);

    expect(childNode?.status).toBe('blocked');
    expect(childNode?.blockers).toContain(186);

    expect(dag.getReadyNodes().map((n) => n.issue.number)).toEqual([186]);
    expect(dag.getBlockedNodes().map((n) => n.issue.number).sort()).toEqual([187, 195]);
  });

  it('should respect allowedProviders when assigning node.runnerName from issue labels', () => {
    const issues: GitHubIssue[] = [
      {
        number: 10,
        title: 'Task with agy label',
        body: 'Do something',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }, { name: 'runner:agy' }],
        url: 'https://github.com/owner/repo/issues/10',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    // Case 1: agy is allowed
    const dagAllowed = new IssueDAG({
      ...DEFAULT_CONFIG,
      runner: 'claude',
      allowedProviders: ['claude', 'agy'],
    });
    dagAllowed.build(issues);
    expect(dagAllowed.getNode(10)?.runnerName).toBe('agy');

    // Case 2: agy is NOT allowed -> falls back to default runner (claude)
    const dagDisallowed = new IssueDAG({
      ...DEFAULT_CONFIG,
      runner: 'claude',
      allowedProviders: ['claude'],
    });
    dagDisallowed.build(issues);
    expect(dagDisallowed.getNode(10)?.runnerName).toBe('claude');
  });

  it('should correctly return triage nodes and filter by target specs', () => {
    const issues: GitHubIssue[] = [
      {
        number: 1,
        title: 'Ready Ticket',
        body: 'Do ready work',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/1',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 2,
        title: 'Needs Triage Ticket 1',
        body: 'Needs classification',
        state: 'OPEN',
        labels: [{ name: 'needs-triage' }],
        url: 'https://github.com/owner/repo/issues/2',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 3,
        title: 'Unlabeled Open Ticket',
        body: 'Just created',
        state: 'OPEN',
        labels: [],
        url: 'https://github.com/owner/repo/issues/3',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 50,
        title: '[Spec] Spec 50',
        body: 'Subtasks:\n- [ ] #51',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/50',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      {
        number: 51,
        title: 'Spec Child Untriaged',
        body: 'Parent: #50',
        state: 'OPEN',
        labels: [{ name: 'needs-triage' }],
        url: 'https://github.com/owner/repo/issues/51',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
    ];

    const unscopedDag = new IssueDAG(DEFAULT_CONFIG);
    unscopedDag.build(issues);
    expect(unscopedDag.getTriageNodes().map((n) => n.issue.number).sort()).toEqual([2, 3, 51]);

    const scopedDag = new IssueDAG({ ...DEFAULT_CONFIG, targetSpec: 50 });
    scopedDag.build(issues);
    expect(scopedDag.getTriageNodes().map((n) => n.issue.number)).toEqual([51]);
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


