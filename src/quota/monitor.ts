import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface RollingWindowStats {
  turnsCount: number;
  totalOutputTokens: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  earliestTurnTimestamp?: number;
  nextRollOffAt?: Date;
  tokensExpiringInNextHour: number;
  burnRatePerMinute: number;
  estimatedCeiling: number;
  utilization: number;
  isApproachingLimit: boolean;
}

export interface QuotaStatus {
  isPaused: boolean;
  pausedAt?: Date;
  resetAt?: Date;
  reason?: string;
  activePids: number[];
  rollingStats?: RollingWindowStats;
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

  public scanRollingWindowUsage(
    utilizationThreshold: number = 0.85,
    customCeiling?: number
  ): RollingWindowStats {
    const fiveHoursMs = 5 * 60 * 60 * 1000;
    const windowStart = Date.now() - fiveHoursMs;
    const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
    const oneHourFromNow = Date.now() + 60 * 60 * 1000;

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreate = 0;
    let recentTokens = 0;
    let tokensExpiringNextHour = 0;
    let earliestTurnTimestamp: number | undefined = undefined;
    let turnsCount = 0;

    try {
      const claudeDir = path.join(os.homedir(), '.claude', 'projects');
      if (fs.existsSync(claudeDir)) {
        const scanDir = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              scanDir(fullPath);
            } else if (entry.name.endsWith('.jsonl')) {
              try {
                const stat = fs.statSync(fullPath);
                if (stat.mtimeMs >= windowStart) {
                  const content = fs.readFileSync(fullPath, 'utf8');
                  const lines = content.split('\n');
                  for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                      const data = JSON.parse(line);
                      if (data.timestamp && data.message?.usage) {
                        const ts = new Date(data.timestamp).getTime();
                        if (ts >= windowStart) {
                          const u = data.message.usage;
                          const output = u.output_tokens || 0;
                          totalInput += u.input_tokens || 0;
                          totalOutput += output;
                          totalCacheRead += u.cache_read_input_tokens || 0;
                          totalCacheCreate += u.cache_creation_input_tokens || 0;
                          turnsCount++;

                          if (!earliestTurnTimestamp || ts < earliestTurnTimestamp) {
                            earliestTurnTimestamp = ts;
                          }

                          if (ts >= thirtyMinsAgo) {
                            recentTokens += output;
                          }

                          // If this turn will roll off in the next 1 hour:
                          const rollOffTime = ts + fiveHoursMs;
                          if (rollOffTime <= oneHourFromNow) {
                            tokensExpiringNextHour += output;
                          }
                        }
                      }
                    } catch {}
                  }
                }
              } catch {}
            }
          }
        };

        scanDir(claudeDir);
      }
    } catch {}

    const estimatedCeiling = customCeiling || 300000;
    const utilization = Math.min(1.0, totalOutput / estimatedCeiling);
    const isApproachingLimit = utilization >= utilizationThreshold;
    const nextRollOffAt = earliestTurnTimestamp ? new Date(earliestTurnTimestamp + fiveHoursMs) : undefined;
    const burnRatePerMinute = Math.round(recentTokens / 30);

    return {
      turnsCount,
      totalOutputTokens: totalOutput,
      totalInputTokens: totalInput,
      totalCacheReadTokens: totalCacheRead,
      totalCacheCreateTokens: totalCacheCreate,
      earliestTurnTimestamp,
      nextRollOffAt,
      tokensExpiringInNextHour: tokensExpiringNextHour,
      burnRatePerMinute,
      estimatedCeiling,
      utilization,
      isApproachingLimit,
    };
  }

  public getStatus(utilizationThreshold: number = 0.85): QuotaStatus {
    const rollingStats = this.scanRollingWindowUsage(utilizationThreshold);

    return {
      isPaused: this.isPaused,
      pausedAt: this.pausedAt,
      resetAt: this.resetAt,
      reason: this.pauseReason,
      activePids: Array.from(this.activePids),
      rollingStats,
    };
  }

  public getRemainingPauseTimeMs(): number {
    if (!this.isPaused || !this.resetAt) return 0;
    return Math.max(0, this.resetAt.getTime() - Date.now());
  }
}
