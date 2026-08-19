import { describe, it, expect } from 'vitest';
import { ClaudeRunner } from '../src/runners/claude.js';
import type { TaskContext } from '../src/types/index.js';

describe('ClaudeRunner', () => {
  it('should strictly construct prompts invoking the /implement skill', () => {
    const runner = new ClaudeRunner();
    const context: TaskContext = {
      issue: {
        number: 42,
        title: 'Add REST endpoint for metrics',
        body: 'Create /api/metrics endpoint returning Prometheus format.',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/42',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      kind: 'standalone',
      worktreePath: '/tmp/worktree',
      branchName: 'agent/issue-42-metrics',
      baseBranch: 'main',
    };

    const prompt = runner.buildPrompt(context);
    expect(prompt).toContain('/implement Issue #42: Add REST endpoint for metrics');
    expect(prompt).toContain('Create /api/metrics endpoint returning Prometheus format.');
    expect(prompt).toContain('gh issue comment');
    expect(prompt).toContain('needs-info');
  });

  it('should format continuation prompt with user feedback when resuming', () => {
    const runner = new ClaudeRunner();
    const context: TaskContext = {
      issue: {
        number: 42,
        title: 'Add REST endpoint for metrics',
        body: 'Create /api/metrics endpoint.',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/42',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      kind: 'standalone',
      worktreePath: '/tmp/worktree',
      branchName: 'agent/issue-42-metrics',
      baseBranch: 'main',
      isContinuation: true,
      userFeedback: 'Use prom-client npm library for formatting.',
    };

    const prompt = runner.buildPrompt(context);
    expect(prompt).toContain('/implement Resume Issue #42: Add REST endpoint for metrics');
    expect(prompt).toContain('Use prom-client npm library for formatting.');
  });

  it('should inject repository-specific extraPrompt when configured', () => {
    const runner = new ClaudeRunner();
    const context: TaskContext = {
      issue: {
        number: 42,
        title: 'Add REST endpoint for metrics',
        body: 'Create /api/metrics endpoint.',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/42',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      kind: 'standalone',
      worktreePath: '/tmp/worktree',
      branchName: 'agent/issue-42-metrics',
      baseBranch: 'main',
      extraPrompt: 'Always copy server/.env to worktree before running server tests.',
    };

    const prompt = runner.buildPrompt(context);
    expect(prompt).toContain('### Repository Instructions');
    expect(prompt).toContain('Always copy server/.env to worktree before running server tests.');
  });
});
