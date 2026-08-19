import { describe, it, expect } from 'vitest';
import { AgyUsageProvider } from '../src/quota/providers/agy.js';
import { ClaudeUsageProvider } from '../src/quota/providers/claude.js';
import { QuotaMonitor } from '../src/quota/monitor.js';

describe('AgyUsageProvider & Multi-Runner Quota', () => {
  it('should correctly parse tab-delimited agy /usage output', () => {
    const rawOutput = `Quota:
Gemini Models\tWeekly Limit Remaining\t89%\t2026-08-26T12:36:06Z
Gemini Models\tFive Hour Limit Remaining\t98%\t2026-08-20T01:20:27Z
Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-08-26T21:00:02Z
Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-08-20T02:00:02Z`;

    const provider = new AgyUsageProvider();
    const usage = provider.parseUsageOutput(rawOutput);

    expect(usage.runnerName).toBe('agy');
    expect(usage.buckets).toHaveLength(4);

    const gemini5h = usage.buckets.find((b) => b.group === 'Gemini Models' && b.windowType === 'five_hour');
    expect(gemini5h).toBeDefined();
    expect(gemini5h!.remainingPercentage).toBe(98);
    expect(gemini5h!.usedPercentage).toBe(2);
    expect(gemini5h!.resetAt).toBeDefined();
    expect(gemini5h!.resetAt!.toISOString()).toBe('2026-08-20T01:20:27.000Z');

    const geminiWeekly = usage.buckets.find((b) => b.group === 'Gemini Models' && b.windowType === 'weekly');
    expect(geminiWeekly).toBeDefined();
    expect(geminiWeekly!.remainingPercentage).toBe(89);
    expect(geminiWeekly!.usedPercentage).toBe(11);
  });

  it('should parse multi-space delimited agy /usage output', () => {
    const rawOutput = `Quota:
Gemini Models          Weekly Limit Remaining     89%   2026-08-26T12:36:06Z
Gemini Models          Five Hour Limit Remaining  98%   2026-08-20T01:20:27Z
Claude and GPT models  Weekly Limit Remaining     100%  2026-08-26T21:00:02Z
Claude and GPT models  Five Hour Limit Remaining  100%  2026-08-20T02:00:02Z`;

    const provider = new AgyUsageProvider();
    const usage = provider.parseUsageOutput(rawOutput);

    expect(usage.buckets).toHaveLength(4);
    const claude5h = usage.buckets.find((b) => b.group === 'Claude and GPT models' && b.windowType === 'five_hour');
    expect(claude5h).toBeDefined();
    expect(claude5h!.remainingPercentage).toBe(100);
    expect(claude5h!.usedPercentage).toBe(0);
  });

  it('should parse Claude live usage output into QuotaBuckets', () => {
    const rawOutput = 'Current session: 25% used · resets 3:00pm\nCurrent week (all models): 60% used · resets Aug 26';
    const provider = new ClaudeUsageProvider();
    const { liveUsage, runnerUsage } = provider.parseUsageOutput(rawOutput);

    expect(liveUsage.sessionUsedPercentage).toBe(25);
    expect(liveUsage.weekUsedPercentage).toBe(60);
    expect(runnerUsage.buckets).toHaveLength(2);
    expect(runnerUsage.buckets[0].usedPercentage).toBe(25);
    expect(runnerUsage.buckets[0].remainingPercentage).toBe(75);
    expect(runnerUsage.buckets[1].usedPercentage).toBe(60);
  });

  it('should register both Claude and AGY providers in QuotaMonitor', () => {
    const monitor = new QuotaMonitor();
    expect(monitor.getProvider('claude')).toBeDefined();
    expect(monitor.getProvider('agy')).toBeDefined();
  });

  it('should check availability on providers', async () => {
    const agy = new AgyUsageProvider();
    const claude = new ClaudeUsageProvider();
    expect(typeof (await agy.isAvailable())).toBe('boolean');
    expect(typeof (await claude.isAvailable())).toBe('boolean');
  });

  it('should return null if provider binary is unavailable', async () => {
    const provider = new AgyUsageProvider();
    // Override isAvailable for testing
    provider.isAvailable = async () => false;
    const usage = await provider.fetchUsage();
    expect(usage).toBeNull();
  });
});
