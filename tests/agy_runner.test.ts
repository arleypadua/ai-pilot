import { describe, it, expect } from 'vitest';
import { AgyRunner } from '../src/runners/agy.js';
import type { TaskContext } from '../src/types/index.js';

describe('AgyRunner', () => {
  it('should construct prompt with task description and repository guidelines', () => {
    const runner = new AgyRunner();
    const context: TaskContext = {
      issue: {
        number: 101,
        title: 'Add support for SQLite cache backend',
        body: 'Implement SQLite cache driver with WAL mode.',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }, { name: 'runner:agy' }],
        url: 'https://github.com/owner/repo/issues/101',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      kind: 'ticket',
      worktreePath: '/tmp/worktree-101',
      branchName: 'agent/issue-101-cache',
      baseBranch: 'main',
    };

    const prompt = runner.buildPrompt(context);
    expect(prompt).toContain('Implement the requested task for https://github.com/owner/repo/issues/101');
    expect(prompt).toContain('Implement SQLite cache driver with WAL mode.');
    expect(prompt).toContain('gh issue comment');
    expect(prompt).toContain('❓ **Agent Question**:');
    expect(prompt).toContain('needs-info');
    expect(prompt).toContain('ready-for-agent');
    expect(prompt).toContain('gh pr create');
    expect(prompt).toContain('gh pr merge');
  });

  it('should format continuation prompt with user steering and feedback', () => {
    const runner = new AgyRunner();
    const context: TaskContext = {
      issue: {
        number: 101,
        title: 'Add support for SQLite cache backend',
        body: 'Implement SQLite cache driver with WAL mode.',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/101',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      kind: 'ticket',
      worktreePath: '/tmp/worktree-101',
      branchName: 'agent/issue-101-cache',
      baseBranch: 'main',
      isContinuation: true,
      userFeedback: 'Use better-sqlite3 instead of sqlite3 npm package.',
    };

    const prompt = runner.buildPrompt(context);
    expect(prompt).toContain('Developer Clarification & Steering');
    expect(prompt).toContain('Use better-sqlite3 instead of sqlite3 npm package.');
    expect(prompt).toContain('Implement SQLite cache driver with WAL mode.');
  });

  it('should inject repository-specific extraPrompt when configured', () => {
    const runner = new AgyRunner();
    const context: TaskContext = {
      issue: {
        number: 101,
        title: 'Add support for SQLite cache backend',
        body: 'Implement SQLite cache driver with WAL mode.',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/101',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      kind: 'ticket',
      worktreePath: '/tmp/worktree-101',
      branchName: 'agent/issue-101-cache',
      baseBranch: 'main',
      extraPrompt: 'Run pnpm db:migrate before testing.',
    };

    const prompt = runner.buildPrompt(context);
    expect(prompt).toContain('### Repository Instructions');
    expect(prompt).toContain('Run pnpm db:migrate before testing.');
  });
});
