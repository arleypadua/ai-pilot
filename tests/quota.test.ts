import { describe, it, expect } from 'vitest';
import { QuotaMonitor } from '../src/quota/monitor.js';

describe('QuotaMonitor', () => {
  it('should detect 429 and rate limit error strings', () => {
    const monitor = new QuotaMonitor();
    const result = monitor.checkOutputForRateLimit('Error: 429 Too Many Requests. Usage limit reached.');
    expect(result.isRateLimited).toBe(true);
    expect(result.resetAt).toBeDefined();
  });

  it('should parse reset duration in minutes', () => {
    const monitor = new QuotaMonitor();
    const result = monitor.checkOutputForRateLimit('Rate limit reached. Resets in 45 minutes.');
    expect(result.isRateLimited).toBe(true);
    expect(result.resetAt).toBeDefined();

    const diffMinutes = Math.round((result.resetAt!.getTime() - Date.now()) / (60 * 1000));
    expect(diffMinutes).toBeCloseTo(45, -1);
  });

  it('should detect Claude Code "hit your session limit · resets 5pm (Europe/Amsterdam)"', () => {
    const monitor = new QuotaMonitor();
    const result = monitor.checkOutputForRateLimit("You've hit your session limit · resets 5pm (Europe/Amsterdam)");
    expect(result.isRateLimited).toBe(true);
    expect(result.resetAt).toBeDefined();
    expect(result.resetAt!.getHours()).toBe(17);
  });

  it('should return false for normal output', () => {
    const monitor = new QuotaMonitor();
    const result = monitor.checkOutputForRateLimit('Successfully executed test suite: 12 tests passed.');
    expect(result.isRateLimited).toBe(false);
    expect(result.resetAt).toBeUndefined();
  });

  describe('ClaudeUsageProvider Session Limit Parsing', () => {
    it('should parse "You\'ve hit your session limit · resets 11am (Europe/Amsterdam)" as 100% usage', () => {
      const monitor = new QuotaMonitor();
      const provider = monitor.getProvider('claude') as any;
      expect(provider).toBeDefined();

      const { liveUsage, runnerUsage } = provider.parseUsageOutput("You've hit your session limit · resets 11am (Europe/Amsterdam)");
      expect(liveUsage.sessionUsedPercentage).toBe(100);
      expect(liveUsage.sessionResetAt).toBeDefined();
      expect(liveUsage.sessionResetAt.getHours()).toBe(11);
      expect(liveUsage.sessionResetText).toContain('11am');
      expect(runnerUsage.buckets[0].usedPercentage).toBe(100);
      expect(runnerUsage.buckets[0].remainingPercentage).toBe(0);
    });

    it('should parse standard "Current session: 45% used · resets 3pm" properly', () => {
      const monitor = new QuotaMonitor();
      const provider = monitor.getProvider('claude') as any;
      const { liveUsage } = provider.parseUsageOutput("Current session: 45% used · resets 3pm");
      expect(liveUsage.sessionUsedPercentage).toBe(45);
      expect(liveUsage.sessionResetAt).toBeDefined();
      expect(liveUsage.sessionResetAt.getHours()).toBe(15);
    });
  });

  describe('QuotaMonitor Deduplication & Guard', () => {
    it('should deduplicate pause events and aggregate affectedIssues', () => {
      const monitor = new QuotaMonitor();
      const pausedEvents: any[] = [];
      monitor.on('quota_paused', (e) => pausedEvents.push(e));

      const resetAt = new Date(Date.now() + 60 * 60 * 1000);
      monitor.triggerQuotaPause(resetAt, 'Quota limit', 'claude', [201]);
      expect(pausedEvents.length).toBe(1);
      expect(pausedEvents[0].affectedIssues).toEqual([201]);

      // Second trigger with same reset time should NOT emit duplicate event, but merges affected issues
      monitor.triggerQuotaPause(resetAt, 'Quota limit', 'claude', [202]);
      expect(pausedEvents.length).toBe(1);

      const status = monitor.getStatus();
      expect(status.pausedRunners?.claude?.affectedIssues).toEqual([201, 202]);
    });

    it('should not prematurely unpause a runner if resetAt is in the future', async () => {
      const monitor = new QuotaMonitor();
      const futureReset = new Date(Date.now() + 2 * 60 * 60 * 1000);
      monitor.triggerQuotaPause(futureReset, 'Session limit', 'claude', [201, 202]);
      expect(monitor.isRunnerPaused('claude')).toBe(true);

      // Simulating a live usage poll that returns cached or empty telemetry
      const provider = monitor.getProvider('claude') as any;
      provider.fetchUsage = async () => null;
      provider.isAvailable = async () => true;
      provider.getCachedLiveUsage = () => ({
        sessionUsedPercentage: 0,
        sessionResetText: undefined,
        sessionResetAt: undefined,
        lastFetchedAt: new Date(),
      });

      const agyProvider = monitor.getProvider('agy') as any;
      agyProvider.fetchUsage = async () => null;

      await monitor.fetchLiveUsage(false);
      // Runner MUST remain paused because resetAt is 2 hours in the future!
      expect(monitor.isRunnerPaused('claude')).toBe(true);
    });
  });
});
