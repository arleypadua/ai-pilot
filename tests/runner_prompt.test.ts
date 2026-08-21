import { describe, it, expect } from 'vitest';
import { buildRunnerPrompt, buildGuidelines } from '../src/runners/prompt.js';
import type { TaskContext } from '../src/types/index.js';

describe('Runner Prompt Builder', () => {
  const baseContext: TaskContext = {
    issue: {
      number: 55,
      title: 'Fix race condition in session watcher',
      body: 'Resolve data race between watcher and exit handler.',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }],
      url: 'https://github.com/owner/repo/issues/55',
      createdAt: '2026-08-20T10:00:00Z',
      updatedAt: '2026-08-20T10:00:00Z',
    },
    kind: 'ticket',
    worktreePath: '/tmp/worktree-55',
    branchName: 'agent/issue-55',
    baseBranch: 'main',
  };

  it('builds full prompt for initial run including guidelines, protocols, and task description', () => {
    const prompt = buildRunnerPrompt(baseContext);

    expect(prompt).toContain('Implement the requested task for https://github.com/owner/repo/issues/55');
    expect(prompt).toContain('### Task Description');
    expect(prompt).toContain('Resolve data race between watcher and exit handler.');
    expect(prompt).toContain('### Guidelines & Protocol');
    expect(prompt).toContain('needs-triage');
    expect(prompt).toContain('No work can be enqueued to the agent without human consent');
    expect(prompt).toContain('gh pr merge --squash --delete-branch');
  });

  it('omits redundant task description and guidelines on continuation turns', () => {
    const continuationContext: TaskContext = {
      ...baseContext,
      isContinuation: true,
      userFeedback: 'Focus on the cleanupProcess handler mutex.',
    };

    const prompt = buildRunnerPrompt(continuationContext);

    expect(prompt).toContain('Developer Clarification & Steering');
    expect(prompt).toContain('Focus on the cleanupProcess handler mutex.');
    expect(prompt).not.toContain('### Task Description');
    expect(prompt).not.toContain('Resolve data race between watcher and exit handler.');
    expect(prompt).not.toContain('### Guidelines & Protocol');
  });

  it('provides a concise resume directive when resuming continuation without feedback', () => {
    const resumeContext: TaskContext = {
      ...baseContext,
      isContinuation: true,
    };

    const prompt = buildRunnerPrompt(resumeContext);

    expect(prompt).toContain('Resume work on this task after a session pause');
    expect(prompt).not.toContain('### Task Description');
    expect(prompt).not.toContain('### Guidelines & Protocol');
  });

  it('supports custom task prefix and code review hints', () => {
    const customPrompt = buildRunnerPrompt(baseContext, {
      taskPrefix: (ref) => `/implement ${ref}`,
      codeReviewHint: 'e.g. `/code-review`',
    });

    expect(customPrompt.startsWith('/implement https://github.com/owner/repo/issues/55')).toBe(true);
    expect(customPrompt).toContain('Verify changes with tests and code review (e.g. `/code-review`).');
  });

  it('formats guidelines without auto-merge when autoMerge is false', () => {
    const guidelines = buildGuidelines({
      ...baseContext,
      autoMerge: false,
    });

    expect(guidelines).toContain('leave the Pull Request open for developer review and merge (do not auto-merge)');
    expect(guidelines).not.toContain('gh pr merge');
  });
});
