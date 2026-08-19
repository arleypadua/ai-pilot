import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateManager } from '../src/state/manager.js';

describe('StateManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-state-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create session files and record stages', () => {
    const stateMgr = new StateManager(tmpDir);

    const session = stateMgr.startTaskSession({
      issueNumber: 99,
      title: 'Add Redis cache',
      branchName: 'agent/issue-99-redis',
      worktreePath: path.join(tmpDir, '.autopilot', 'worktrees', 'issue-99'),
      runner: 'claude',
    });

    expect(session.issueNumber).toBe(99);
    expect(session.status).toBe('running');

    // Append logs
    stateMgr.appendTaskLog(99, 'stdout', 'Installing redis dependency...\n');
    stateMgr.appendTaskLog(99, 'stdout', 'Created redis client.\n');

    // Record stage
    stateMgr.recordTaskStage(99, 'TESTING', 'testing', 'Running vitest on redis client');

    // Verify session data
    const sessionData = stateMgr.getSession(99);
    expect(sessionData.metadata?.status).toBe('testing');
    expect(sessionData.metadata?.timeline.length).toBeGreaterThan(1);
    expect(sessionData.stdout).toContain('Created redis client.');

    // Finish session
    stateMgr.finishTaskSession(99, 'completed', { prUrl: 'https://github.com/owner/repo/pull/1' });

    const finalState = stateMgr.getState();
    expect(finalState.activeTasks[99]).toBeUndefined();
    expect(finalState.recentHistory.length).toBe(1);
    expect(finalState.recentHistory[0].issueNumber).toBe(99);
  });
});
