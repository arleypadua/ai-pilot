import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelegramRateLimiter } from '../src/remote/rate_limiter.js';

describe('TelegramRateLimiter', () => {
  let limiter: TelegramRateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (limiter) {
      limiter.destroy();
    }
    vi.useRealTimers();
  });

  it('executes a single item immediately', async () => {
    limiter = new TelegramRateLimiter({ minChatIntervalMs: 1000, minGlobalIntervalMs: 34 });
    const fn = vi.fn().mockResolvedValue('ok');

    const promise = limiter.enqueue(12345, fn);
    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('enforces 1 msg/s (minChatIntervalMs) per-chat limit', async () => {
    limiter = new TelegramRateLimiter({ minChatIntervalMs: 1000, minGlobalIntervalMs: 10 });
    const fn1 = vi.fn().mockResolvedValue('msg1');
    const fn2 = vi.fn().mockResolvedValue('msg2');

    const p1 = limiter.enqueue(12345, fn1);
    const p2 = limiter.enqueue(12345, fn2);

    await vi.advanceTimersByTimeAsync(0);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).not.toHaveBeenCalled();

    // Advance 500ms (not yet 1000ms)
    await vi.advanceTimersByTimeAsync(500);
    expect(fn2).not.toHaveBeenCalled();

    // Advance remaining 500ms
    await vi.advanceTimersByTimeAsync(500);
    expect(fn2).toHaveBeenCalledTimes(1);

    const res1 = await p1;
    const res2 = await p2;
    expect(res1).toBe('msg1');
    expect(res2).toBe('msg2');
  });

  it('allows concurrent dispatches to different chats respecting global interval', async () => {
    limiter = new TelegramRateLimiter({ minChatIntervalMs: 1000, minGlobalIntervalMs: 50 });
    const fn1 = vi.fn().mockResolvedValue('chat1');
    const fn2 = vi.fn().mockResolvedValue('chat2');

    const p1 = limiter.enqueue('chat-1', fn1);
    const p2 = limiter.enqueue('chat-2', fn2);

    await vi.advanceTimersByTimeAsync(0);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).not.toHaveBeenCalled();

    // Advance global interval (50ms)
    await vi.advanceTimersByTimeAsync(50);
    expect(fn2).toHaveBeenCalledTimes(1);

    await p1;
    await p2;
  });

  it('prioritizes high priority requests over normal and low', async () => {
    limiter = new TelegramRateLimiter({ minChatIntervalMs: 1000, minGlobalIntervalMs: 10 });
    const order: string[] = [];

    const fn1 = vi.fn().mockImplementation(async () => {
      order.push('first');
      return 'first';
    });
    const fnLow = vi.fn().mockImplementation(async () => {
      order.push('low');
      return 'low';
    });
    const fnHigh = vi.fn().mockImplementation(async () => {
      order.push('high');
      return 'high';
    });
    const fnNormal = vi.fn().mockImplementation(async () => {
      order.push('normal');
      return 'normal';
    });

    limiter.enqueue(123, fn1, { priority: 'normal' });
    await vi.advanceTimersByTimeAsync(0);

    limiter.enqueue(123, fnLow, { priority: 'low' });
    limiter.enqueue(123, fnHigh, { priority: 'high' });
    limiter.enqueue(123, fnNormal, { priority: 'normal' });

    // Next item should be high
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['first', 'high']);

    // Next item should be normal
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['first', 'high', 'normal']);

    // Next item should be low
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['first', 'high', 'normal', 'low']);
  });

  it('handles HTTP 429 retry_after and automatically retries', async () => {
    limiter = new TelegramRateLimiter({
      minChatIntervalMs: 100,
      minGlobalIntervalMs: 10,
      retryAfterBufferMs: 50,
      defaultMaxRetries: 3,
    });

    const error429 = {
      parameters: { retry_after: 2 },
      status: 429,
      message: 'Too Many Requests: retry after 2',
    };

    let attempts = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw error429;
      }
      return 'success after retry';
    });

    const promise = limiter.enqueue(123, fn);

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(limiter.isPaused()).toBe(true);

    // Should pause for 2000ms + 50ms buffer = 2050ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1100);
    expect(fn).toHaveBeenCalledTimes(2);

    const result = await promise;
    expect(result).toBe('success after retry');
  });

  it('rejects when max retries are exceeded on 429', async () => {
    limiter = new TelegramRateLimiter({
      minChatIntervalMs: 10,
      minGlobalIntervalMs: 10,
      retryAfterBufferMs: 10,
      defaultMaxRetries: 2,
    });

    const error429 = {
      parameters: { retry_after: 1 },
      status: 429,
    };

    const fn = vi.fn().mockRejectedValue(error429);

    const promise = limiter.enqueue(123, fn);
    const assertion = expect(promise).rejects.toEqual(error429);

    // Initial attempt + 2 retries = 3 calls
    await vi.advanceTimersByTimeAsync(0); // Attempt 1
    await vi.advanceTimersByTimeAsync(1100); // Retry 1
    await vi.advanceTimersByTimeAsync(1100); // Retry 2

    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rejects immediately on non-429 error without retry', async () => {
    limiter = new TelegramRateLimiter({ minChatIntervalMs: 10, minGlobalIntervalMs: 10 });
    const error500 = new Error('Internal Server Error');
    const fn = vi.fn().mockRejectedValue(error500);

    const promise = limiter.enqueue(123, fn);
    const assertion = expect(promise).rejects.toThrow('Internal Server Error');
    await vi.advanceTimersByTimeAsync(0);

    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clears all queued requests and rejects them', async () => {
    limiter = new TelegramRateLimiter({ minChatIntervalMs: 1000 });
    limiter.pause(5000);
    const fn1 = vi.fn().mockResolvedValue('ok');
    const fn2 = vi.fn().mockResolvedValue('ok');

    const p1 = limiter.enqueue(123, fn1);
    const p2 = limiter.enqueue(123, fn2);

    expect(limiter.getQueueLength()).toBe(2);
    limiter.clear();
    expect(limiter.getQueueLength()).toBe(0);

    await expect(p1).rejects.toThrow('RateLimiter queue cleared');
    await expect(p2).rejects.toThrow('RateLimiter queue cleared');
  });

  it('rejects enqueue after destroy', async () => {
    limiter = new TelegramRateLimiter();
    limiter.destroy();

    await expect(limiter.enqueue(123, async () => 'ok')).rejects.toThrow('RateLimiter is destroyed');
  });
});

