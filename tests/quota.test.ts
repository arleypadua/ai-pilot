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
});
