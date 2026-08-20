import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../src/pipeline/orchestrator.js';
import type { AutoPilotConfig, DAGNode, GitHubIssue } from '../src/types/index.js';
import { GitHubClient } from '../src/github/client.js';
import { WorktreeManager } from '../src/worktree/manager.js';
import { RunnerFacade } from '../src/runners/facade.js';
import { StateManager } from '../src/state/manager.js';
import { Notifier } from '../src/notifications/notifier.js';

vi.mock('../src/github/client.js');
vi.mock('../src/worktree/manager.js');
vi.mock('../src/runners/facade.js');
vi.mock('../src/notifications/notifier.js');

describe('Orchestrator Auto-Resume on Timeout & Failure Retry Policy', () => {
  let config: AutoPilotConfig;
  let orchestrator: Orchestrator;
  let mockGh: any;
  let mockWorktreeMgr: any;
  let mockRunnerFacade: any;

  beforeEach(() => {
    vi.clearAllMocks();

    config = {
      repository: 'owner/repo',
      baseBranch: 'main',
      maxConcurrency: 2,
      maxAutoNudges: 2,
      maxRetriesOnFailure: 2,
      pollIntervalSeconds: 10,
      runner: 'agy',
      autoMerge: true,
      mergeMethod: 'squash',
      cleanupWorktreeOnClose: true,
      remote: { enabled: false, provider: 'telegram', telegram: { botTokenEnv: 'TOKEN', notifications: { needsInfo: true, quotaPaused: true, taskCompleted: true, specCompleted: true } } },
      quota: { pauseOnLimit: true, utilizationThreshold: 0.85, proxyPort: 9876 },
      labels: {
        readyForAgent: 'ready-for-agent',
        needsInfo: 'needs-info',
        readyForHuman: 'ready-for-human',
        needsTriage: 'needs-triage',
        wontfix: 'wontfix',
      },
    };

    orchestrator = new Orchestrator(config);

    mockGh = (orchestrator as any).gh;
    mockWorktreeMgr = (orchestrator as any).worktreeMgr;
    mockRunnerFacade = (orchestrator as any).runnerFacade;

    mockWorktreeMgr.worktreeExists.mockResolvedValue(false);
    mockWorktreeMgr.createWorktree.mockResolvedValue({
      worktreePath: '/tmp/worktree-24',
      branchName: 'agent/issue-24',
    });

    mockGh.addComment.mockResolvedValue({});
    mockGh.editIssueLabels.mockResolvedValue({});
    mockGh.viewIssue.mockResolvedValue({
      number: 24,
      title: 'Test Issue',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
    });
    mockGh.findPRForBranch.mockResolvedValue(null);
  });

  it('should auto-resume with continuation prompt when runner times out', async () => {
    const issue: GitHubIssue = {
      number: 24,
      title: 'feat: notifications',
      body: 'Task description',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/24',
      createdAt: '2026-08-20T10:00:00Z',
      updatedAt: '2026-08-20T10:00:00Z',
    };

    const node: DAGNode = {
      issue,
      kind: 'ticket',
      blockers: [],
      dependents: [],
      children: [],
      status: 'ready',
      runnerName: 'agy',
    };

    // First call times out, second call completes
    mockRunnerFacade.run
      .mockResolvedValueOnce({
        success: false,
        status: 'TIMED_OUT',
        isTimeout: true,
        error: 'timeout waiting for response',
      })
      .mockResolvedValueOnce({
        success: true,
        status: 'COMPLETED',
      });

    // Mock PR found on completion
    mockGh.findPRForBranch.mockResolvedValue({ number: 10, url: 'https://github.com/owner/repo/pull/10', state: 'OPEN' });
    mockGh.mergePR.mockResolvedValue({});
    mockGh.closeIssue.mockResolvedValue({});

    await (orchestrator as any).executeTask(node, undefined, 0, 0);

    // Verify runner was invoked twice
    expect(mockRunnerFacade.run).toHaveBeenCalledTimes(2);

    // Verify second call received continuation timeout prompt
    const secondCallContext = mockRunnerFacade.run.mock.calls[1][0];
    expect(secondCallContext.userFeedback).toContain('Your previous execution turn timed out while running');
    expect(secondCallContext.userFeedback).toContain('Please inspect the existing worktree');
  });

  it('should auto-retry with error details when runner exits with failure', async () => {
    const issue: GitHubIssue = {
      number: 24,
      title: 'feat: notifications',
      body: 'Task description',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/24',
      createdAt: '2026-08-20T10:00:00Z',
      updatedAt: '2026-08-20T10:00:00Z',
    };

    const node: DAGNode = {
      issue,
      kind: 'ticket',
      blockers: [],
      dependents: [],
      children: [],
      status: 'ready',
      runnerName: 'agy',
    };

    // First call fails, second call succeeds
    mockRunnerFacade.run
      .mockResolvedValueOnce({
        success: false,
        status: 'FAILED',
        error: 'Process crashed with exit code 1',
      })
      .mockResolvedValueOnce({
        success: true,
        status: 'COMPLETED',
      });

    mockGh.findPRForBranch.mockResolvedValue({ number: 10, url: 'https://github.com/owner/repo/pull/10', state: 'OPEN' });
    mockGh.mergePR.mockResolvedValue({});
    mockGh.closeIssue.mockResolvedValue({});

    await (orchestrator as any).executeTask(node, undefined, 0, 0);

    // Verify runner was invoked twice
    expect(mockRunnerFacade.run).toHaveBeenCalledTimes(2);

    // Verify second call received retry prompt with error context
    const secondCallContext = mockRunnerFacade.run.mock.calls[1][0];
    expect(secondCallContext.userFeedback).toContain('Your previous execution turn encountered an error');
    expect(secondCallContext.userFeedback).toContain('Process crashed with exit code 1');
  });

  it('should transition to ready-for-human after exhausting maxRetriesOnFailure', async () => {
    const issue: GitHubIssue = {
      number: 24,
      title: 'feat: notifications',
      body: 'Task description',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/24',
      createdAt: '2026-08-20T10:00:00Z',
      updatedAt: '2026-08-20T10:00:00Z',
    };

    const node: DAGNode = {
      issue,
      kind: 'ticket',
      blockers: [],
      dependents: [],
      children: [],
      status: 'ready',
      runnerName: 'agy',
    };

    // Fails on all attempts (initial + 2 retries = 3 attempts total)
    mockRunnerFacade.run.mockResolvedValue({
      success: false,
      status: 'FAILED',
      error: 'Unrecoverable syntax error',
    });

    await (orchestrator as any).executeTask(node, undefined, 0, 0);

    expect(mockRunnerFacade.run).toHaveBeenCalledTimes(3);

    // Verify issue was marked ready-for-human
    expect(mockGh.editIssueLabels).toHaveBeenCalledWith(24, {
      add: ['ready-for-human'],
      remove: ['ready-for-agent'],
    });

    // Verify comment posted to issue explaining retries exhausted
    expect(mockGh.addComment).toHaveBeenCalledWith(
      24,
      expect.stringContaining('Agent Failed After 2 Retries')
    );
  });
});
