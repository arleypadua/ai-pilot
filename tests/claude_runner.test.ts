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
    expect(prompt).toContain('/implement https://github.com/owner/repo/issues/42');
    expect(prompt).toContain('Create /api/metrics endpoint returning Prometheus format.');
    expect(prompt).toContain('gh issue comment');
    expect(prompt).toContain('❓ **Agent Question**:');
    expect(prompt).toContain('needs-info');
    expect(prompt).toContain('ready-for-agent');
    expect(prompt).toContain('gh pr create');
    expect(prompt).toContain('gh pr merge');
    expect(prompt).not.toContain('Check current git status');
    expect(prompt).not.toContain('Implement the requested feature or fix in its entirety');
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
    expect(prompt).toContain('/implement https://github.com/owner/repo/issues/42');
    expect(prompt).toContain('Use prom-client npm library for formatting.');
    expect(prompt).toContain('gh pr merge');
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

  it('should format merge instructions according to autoMerge and mergeMethod', () => {
    const runner = new ClaudeRunner();
    const contextWithAutoMerge: TaskContext = {
      issue: {
        number: 42,
        title: 'Add REST endpoint',
        body: 'Create endpoint.',
        state: 'OPEN',
        labels: [{ name: 'ready-for-agent' }],
        url: 'https://github.com/owner/repo/issues/42',
        createdAt: '2026-08-19T10:00:00Z',
        updatedAt: '2026-08-19T10:00:00Z',
      },
      kind: 'standalone',
      worktreePath: '/tmp/worktree',
      branchName: 'agent/issue-42',
      baseBranch: 'main',
      autoMerge: true,
      mergeMethod: 'rebase',
    };

    const promptAuto = runner.buildPrompt(contextWithAutoMerge);
    expect(promptAuto).toContain('gh pr merge --rebase --delete-branch');

    const contextNoAutoMerge: TaskContext = {
      ...contextWithAutoMerge,
      autoMerge: false,
    };
    const promptNoAuto = runner.buildPrompt(contextNoAutoMerge);
    expect(promptNoAuto).toContain('leave the Pull Request open for developer review and merge (do not auto-merge)');
    expect(promptNoAuto).not.toContain('gh pr merge --rebase');
  });
});
