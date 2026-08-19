import { describe, it, expect, beforeEach } from 'vitest';
import { AgentEventBus } from '../src/events/bus.js';
import { loadHistoricalEvents } from '../src/events/history.js';
import { StateManager } from '../src/state/manager.js';

describe('Historical Event Hydration', () => {
  beforeEach(() => {
    AgentEventBus.getInstance().clearHistory();
  });

  it('should load history from session metadata timeline when available', () => {
    const stateMgr = new StateManager();
    const session = stateMgr.startTaskSession({
      issueNumber: 998,
      title: 'Historical test issue',
      branchName: 'agent/issue-998',
      worktreePath: '/tmp/nonexistent-worktree-998',
      runner: 'claude',
    });

    stateMgr.recordTaskStage(998, 'DISPATCHED', 'running', 'Allocated worktree');
    stateMgr.recordTaskStage(998, 'AGENT_RUNNING', 'running', 'Invoking claude /implement');

    const events = loadHistoricalEvents(998);
    expect(events.length).toBeGreaterThan(0);
    const summaryList = events.map((e) => e.summary).join(' ');
    expect(summaryList).toContain('DISPATCHED');
  });

  it('should include quota pause notice if task is paused', () => {
    const stateMgr = new StateManager();
    stateMgr.startTaskSession({
      issueNumber: 997,
      title: 'Paused issue',
      branchName: 'agent/issue-997',
      worktreePath: '/tmp/nonexistent-worktree-997',
      runner: 'claude',
    });
    stateMgr.recordTaskStage(997, 'QUOTA_PAUSED', 'paused_quota', 'Hit 5h rate limit');

    const events = loadHistoricalEvents(997);
    expect(events.length).toBeGreaterThan(0);
    const summaryList = events.map((e) => e.summary).join(' ');
    expect(summaryList).toContain('QUOTA_PAUSED');
  });
});
