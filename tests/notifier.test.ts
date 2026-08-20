import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Notifier } from '../src/notifications/notifier.js';
import { Orchestrator } from '../src/pipeline/orchestrator.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';

describe('Notifier Activity Logging and Interactive Mode', () => {
  let consoleSpy: any;

  beforeEach(() => {
    Notifier.removeAllListeners();
    Notifier.setLogHandler(undefined);
    Notifier.setInteractive(false);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    Notifier.setLogHandler(undefined);
    Notifier.setInteractive(false);
    Notifier.removeAllListeners();
  });

  it('should suppress stdout console.log and route to logHandler when interactive mode is enabled', () => {
    const logs: string[] = [];
    Notifier.setInteractive(true);
    Notifier.setLogHandler((msg) => logs.push(msg));

    Notifier.notifyTaskStarted({
      issueNumber: 24,
      issueTitle: 'feat: outbound milestone notifications',
      runnerName: 'agy',
      branchName: 'agent/issue-24',
    });

    Notifier.notifyTaskMerged(
      24,
      'feat: outbound milestone notifications',
      'https://github.com/owner/repo/pull/30',
      30
    );

    Notifier.notifySpecComplete(22, 'Spec: Extensible Remote Control');
    Notifier.notifyNeedsFeedback(25, 'Interactive quota pause alerts', 'Should we enable auto-resume?');
    Notifier.notifyQuotaPaused(new Date('2026-08-20T19:00:00Z'), 45, 'claude');
    Notifier.notifyQuotaResumed('claude');

    // stdout console.log MUST NOT be called (prevents TUI screen corruption)
    expect(consoleSpy).not.toHaveBeenCalled();

    // logs array MUST contain all events formatted cleanly
    expect(logs.length).toBe(6);
    expect(logs[0]).toContain('🤖 [Task Started] Issue #24: feat: outbound milestone notifications [agy]');
    expect(logs[1]).toContain('🎉 [Completed & Merged] Issue #24: feat: outbound milestone notifications');
    expect(logs[2]).toContain('🎉 [Spec Complete] Spec #22: Spec: Extensible Remote Control');
    expect(logs[3]).toContain('🔔 [Human Feedback Required] Issue #25: Interactive quota pause alerts');
    expect(logs[4]).toContain('⏳ [Quota Limit] Pausing workers');
    expect(logs[5]).toContain('🔄 [Quota Resumed] Quota limits cleared. Resuming workers. [claude]');
  });

  it('should output to stdout console.log in non-interactive headless mode', () => {
    Notifier.setInteractive(false);

    Notifier.notifyTaskStarted({
      issueNumber: 10,
      issueTitle: 'CLI headless task',
      runnerName: 'claude',
    });

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should automatically feed Notifier events into Orchestrator dashboard activity logs', () => {
    const orchestrator = new Orchestrator({
      ...DEFAULT_CONFIG,
      repository: 'owner/test-repo',
    });
    orchestrator.setInteractive(true);

    Notifier.notifyTaskStarted({
      issueNumber: 25,
      issueTitle: 'feat(remote): Interactive quota pause alerts',
      runnerName: 'agy',
      branchName: 'agent/issue-25',
    });

    Notifier.notifyTaskMerged(25, 'feat(remote): Interactive quota pause alerts');

    const activityLogs = orchestrator.getDashboard().getLogs();
    expect(activityLogs.some((l) => l.includes('🤖 [Task Started] Issue #25'))).toBe(true);
    expect(activityLogs.some((l) => l.includes('🎉 [Completed & Merged] Issue #25'))).toBe(true);
  });
});
