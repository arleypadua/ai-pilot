import { describe, it, expect } from 'vitest';
import { RunnerFacade } from '../src/runners/facade.js';
import type { GitHubIssue } from '../src/types/index.js';

describe('RunnerFacade', () => {
  const createMockIssue = (labels: string[]): GitHubIssue => ({
    number: 42,
    title: 'Test issue',
    body: 'Test body',
    state: 'OPEN',
    labels: labels.map((l) => ({ name: l })),
    url: 'https://github.com/owner/repo/issues/42',
    createdAt: '2026-08-19T10:00:00Z',
    updatedAt: '2026-08-19T10:00:00Z',
  });

  it('should resolve default runner when no runner label is present', () => {
    const facade = new RunnerFacade({ defaultRunner: 'claude' });
    const issue = createMockIssue(['ready-for-agent', 'bug']);

    const runnerName = facade.resolveRunnerName(issue);
    expect(runnerName).toBe('claude');

    const runner = facade.resolveRunner(issue);
    expect(runner.name).toBe('claude');
  });

  it('should resolve agy runner when runner:agy label is present', () => {
    const facade = new RunnerFacade({ defaultRunner: 'claude' });
    const issue = createMockIssue(['ready-for-agent', 'runner:agy']);

    const runnerName = facade.resolveRunnerName(issue);
    expect(runnerName).toBe('agy');

    const runner = facade.resolveRunner(issue);
    expect(runner.name).toBe('agy');
  });

  it('should resolve claude runner when runner:claude label is present even if default is agy', () => {
    const facade = new RunnerFacade({ defaultRunner: 'agy' });
    const issue = createMockIssue(['ready-for-agent', 'runner:claude']);

    const runnerName = facade.resolveRunnerName(issue);
    expect(runnerName).toBe('claude');

    const runner = facade.resolveRunner(issue);
    expect(runner.name).toBe('claude');
  });

  it('should support agent:<name> label prefix', () => {
    const facade = new RunnerFacade({ defaultRunner: 'claude' });
    const issue = createMockIssue(['ready-for-agent', 'agent:agy']);

    const runnerName = facade.resolveRunnerName(issue);
    expect(runnerName).toBe('agy');
  });

  it('should list available runners in registry', () => {
    const facade = new RunnerFacade();
    const list = facade.getRegistry().list();
    expect(list).toContain('claude');
    expect(list).toContain('agy');
  });

  it('should detect available runner binaries', async () => {
    const facade = new RunnerFacade();
    const registry = facade.getRegistry();
    const detected = await registry.detectAvailable();
    expect(Array.isArray(detected)).toBe(true);
  });
});
