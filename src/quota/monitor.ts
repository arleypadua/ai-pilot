import { EventEmitter } from 'node:events';

export interface QuotaStatus {
  isPaused: boolean;
  pausedAt?: Date;
  resetAt?: Date;
  reason?: string;
  activePids: number[];
}

export class QuotaMonitor extends EventEmitter {
  private isPaused: boolean = false;
  private pausedAt?: Date;
  private resetAt?: Date;
  private pauseReason?: string;
  private activePids: Set<number> = new Set();
  private resumeTimeout?: NodeJS.Timeout;

  constructor() {
    super();
  }

  public registerPid(pid: number): void {
    this.activePids.add(pid);
  }

  public unregisterPid(pid: number): void {
    this.activePids.delete(pid);
  }

  public checkOutputForRateLimit(text: string): { isRateLimited: boolean; resetAt?: Date; reason?: string } {
    const lower = text.toLowerCase();

    const rateLimitPatterns = [
      'session limit',
      'hit your session limit',
      'usage limit reached',
      'rate limit reached',
      '429 too many requests',
      '5-hour limit',
      'hit your 5-hour limit',
      'hit your usage limit',
      'rate_limit_error',
      'exhausted your quota',
      'overloaded_error',
    ];

    const matched = rateLimitPatterns.some((pattern) => lower.includes(pattern));
    if (!matched) {
      return { isRateLimited: false };
    }

    let resetAt: Date | undefined = undefined;

    // 1. Try parsing "resets in X hours Y minutes" (e.g. "resets in 2 hours 30 minutes", "resets in 4h")
    const inHoursMatch = lower.match(/resets?\s+(?:in|after)\s+(\d+)\s*h(?:ours?)?(?:\s*(\d+)\s*m(?:inutes?)?)?/i);
    if (inHoursMatch) {
      const hours = parseInt(inHoursMatch[1], 10);
      const minutes = inHoursMatch[2] ? parseInt(inHoursMatch[2], 10) : 0;
      const ms = (hours * 60 + minutes) * 60 * 1000;
      resetAt = new Date(Date.now() + ms);
    }

    // 2. Try parsing "resets in X minutes"
    if (!resetAt) {
      const inMinsMatch = lower.match(/resets?\s+(?:in|after)\s+(\d+)\s*m(?:inutes?)?/i);
      if (inMinsMatch) {
        const minutes = parseInt(inMinsMatch[1], 10);
        resetAt = new Date(Date.now() + minutes * 60 * 1000);
      }
    }

    // 3. Try parsing "resets 5pm", "resets at 5pm", "resets 5:00pm", "resets 17:00", "resets at 17:00"
    if (!resetAt) {
      const timeMatch = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1], 10);
        const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const ampm = timeMatch[3]?.toLowerCase();

        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;

        const target = new Date();
        target.setHours(hour, minute, 0, 0);
        if (target.getTime() <= Date.now()) {
          // If the computed time is earlier today, it means tomorrow
          target.setDate(target.getDate() + 1);
        }
        resetAt = target;
      }
    }

    // Default fallback: 1 hour if unspecified
    if (!resetAt) {
      resetAt = new Date(Date.now() + 60 * 60 * 1000);
    }

    return {
      isRateLimited: true,
      resetAt,
      reason: 'Claude 5-Hour / Usage Quota Exceeded',
    };
  }

  public triggerQuotaPause(resetAt: Date, reason: string = 'Quota limit reached'): void {
    if (this.isPaused) return;

    this.isPaused = true;
    this.pausedAt = new Date();
    this.resetAt = resetAt;
    this.pauseReason = reason;

    // Send SIGSTOP to all active child PIDs to freeze RAM execution
    for (const pid of this.activePids) {
      try {
        process.kill(pid, 'SIGSTOP');
      } catch {
        // Process may have already exited
      }
    }

    const waitMs = Math.max(1000, resetAt.getTime() - Date.now());
    this.emit('quota_paused', {
      pausedAt: this.pausedAt,
      resetAt: this.resetAt,
      reason: this.pauseReason,
      waitMs,
    });

    if (this.resumeTimeout) {
      clearTimeout(this.resumeTimeout);
    }

    this.resumeTimeout = setTimeout(() => {
      this.resumeFromQuota();
    }, waitMs);
  }

  public resumeFromQuota(): void {
    if (!this.isPaused) return;

    if (this.resumeTimeout) {
      clearTimeout(this.resumeTimeout);
      this.resumeTimeout = undefined;
    }

    // Send SIGCONT to resume all frozen child PIDs
    for (const pid of this.activePids) {
      try {
        process.kill(pid, 'SIGCONT');
      } catch {
        // Process might have terminated
      }
    }

    this.isPaused = false;
    const previousResetAt = this.resetAt;
    this.pausedAt = undefined;
    this.resetAt = undefined;
    this.pauseReason = undefined;

    this.emit('quota_resumed', { resumedAt: new Date(), previousResetAt });
  }

  public getStatus(): QuotaStatus {
    return {
      isPaused: this.isPaused,
      pausedAt: this.pausedAt,
      resetAt: this.resetAt,
      reason: this.pauseReason,
      activePids: Array.from(this.activePids),
    };
  }

  public getRemainingPauseTimeMs(): number {
    if (!this.isPaused || !this.resetAt) return 0;
    return Math.max(0, this.resetAt.getTime() - Date.now());
  }
}
