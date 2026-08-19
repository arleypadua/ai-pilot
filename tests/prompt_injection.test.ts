import { describe, it, expect } from 'vitest';
import { ClaudeRunner } from '../src/runners/claude.js';
import type { TaskContext } from '../src/types/index.js';

describe('Prompt Injection & Resumption in ClaudeRunner', () => {
  it('should format continuation prompt with injected developer feedback', () => {
    const runner = new ClaudeRunner();
    const context: TaskContext = {
      issue: {
        number: 42,
        title: 'Add metrics endpoint',
        body: 'Implement prometheus metrics.',
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
      isContinuation: true,
      userFeedback: 'Make sure to also include memory and cpu gauges in the metrics response.',
    };

    const prompt = runner.buildPrompt(context);
    expect(prompt).toContain('### Developer Clarification & Steering');
    expect(prompt).toContain('<developer_feedback>');
    expect(prompt).toContain('Make sure to also include memory and cpu gauges in the metrics response.');
    expect(prompt).toContain('</developer_feedback>');
  });

  it('should return false if injecting prompt into non-running task', async () => {
    const runner = new ClaudeRunner();
    const result = await runner.injectPrompt(999, 'Test prompt');
    expect(result).toBe(false);
  });
});
