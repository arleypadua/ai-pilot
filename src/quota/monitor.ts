import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  ClaudeLiveUsage,
  QuotaStatus,
  RollingWindowStats,
  RunnerLiveUsage,
  RunnerPauseInfo,
  UsageProvider,
} from './types.js';
import { ClaudeUsageProvider } from './providers/claude.js';
import { AgyUsageProvider } from './providers/agy.js';

export * from './types.js';
export { ClaudeUsageProvider } from './providers/claude.js';
export { AgyUsageProvider } from './providers/agy.js';

export class QuotaMonitor extends EventEmitter {
  private isPaused: boolean = false;
  private pausedAt?: Date;
  private resetAt?: Date;
  private pauseReason?: string;
  private activePids: Map<number, string> = new Map();
  private resumeTimeout?: NodeJS.Timeout;
  private providers: Map<string, UsageProvider> = new Map();
  private runnerUsages: Map<string, RunnerLiveUsage> = new Map();
  private pausedRunners: Map<string, RunnerPauseInfo> = new Map();
  private claudeProvider: ClaudeUsageProvider;
  private agyProvider: AgyUsageProvider;

  constructor() {
    super();
    this.claudeProvider = new ClaudeUsageProvider();
    this.agyProvider = new AgyUsageProvider();
    this.registerProvider(this.claudeProvider);
    this.registerProvider(this.agyProvider);
  }

  public registerProvider(provider: UsageProvider): void {
    this.providers.set(provider.name, provider);
  }

  public getProvider(name: string): UsageProvider | undefined {
    return this.providers.get(name);
  }

  public registerPid(pid: number, runnerName: string = 'claude'): void {
    this.activePids.set(pid, runnerName.toLowerCase());
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
      'five hour limit',
      'hit your 5-hour limit',
      'hit your usage limit',
      'rate_limit_error',
      'exhausted your quota',
      'resource_exhausted',
      'quota exceeded',
      'overloaded_error',
    ];

    const matched = rateLimitPatterns.some((pattern) => lower.includes(pattern));
    if (!matched) {
      return { isRateLimited: false };
    }

    let resetAt: Date | undefined = undefined;

    // 1. Try parsing ISO timestamp in output (e.g. 2026-08-20T01:20:27Z)
    const isoMatch = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/);
    if (isoMatch) {
      try {
        const parsed = new Date(isoMatch[0]);
        if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
          resetAt = parsed;
        }
      } catch {}
    }

    // 2. Try parsing "resets in X hours Y minutes" (e.g. "resets in 2 hours 30 minutes", "resets in 4h")
    if (!resetAt) {
      const inHoursMatch = lower.match(/resets?\s+(?:in|after)\s+(\d+)\s*h(?:ours?)?(?:\s*(\d+)\s*m(?:inutes?)?)?/i);
      if (inHoursMatch) {
        const hours = parseInt(inHoursMatch[1], 10);
        const minutes = inHoursMatch[2] ? parseInt(inHoursMatch[2], 10) : 0;
        const ms = (hours * 60 + minutes) * 60 * 1000;
        resetAt = new Date(Date.now() + ms);
      }
    }

    // 3. Try parsing "resets in X minutes"
    if (!resetAt) {
      const inMinsMatch = lower.match(/resets?\s+(?:in|after)\s+(\d+)\s*m(?:inutes?)?/i);
      if (inMinsMatch) {
        const minutes = parseInt(inMinsMatch[1], 10);
        resetAt = new Date(Date.now() + minutes * 60 * 1000);
      }
    }

    // 4. Try parsing "resets 5pm", "resets at 5pm", "resets 5:00pm", "resets 17:00", "resets at 17:00"
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
      reason: 'Usage / Quota Limit Exceeded',
    };
  }

  public isRunnerPaused(runnerName: string): boolean {
    const pauseInfo = this.pausedRunners.get(runnerName.toLowerCase());
    if (!pauseInfo) return false;

    if (pauseInfo.resetAt.getTime() <= Date.now()) {
      this.resumeFromQuota(runnerName);
      return false;
    }

    return true;
  }

  public triggerQuotaPause(
    resetAt: Date,
    reason: string = 'Quota limit reached',
    runnerName: string = 'claude'
  ): void {
    const rName = runnerName.toLowerCase();
    this.pausedRunners.set(rName, {
      runnerName: rName,
      pausedAt: new Date(),
      resetAt,
      reason,
    });

    this.isPaused = true;
    this.pausedAt = new Date();
    this.resetAt = resetAt;
    this.pauseReason = reason;

    // Send SIGSTOP only to active child PIDs of the paused runner
    for (const [pid, runner] of this.activePids.entries()) {
      if (runner === rName) {
        try {
          process.kill(pid, 'SIGSTOP');
        } catch {
          // Process may have already exited
        }
      }
    }

    const waitMs = Math.max(1000, resetAt.getTime() - Date.now());
    this.emit('quota_paused', {
      pausedAt: this.pausedAt,
      resetAt: this.resetAt,
      reason: this.pauseReason,
      runnerName: rName,
      waitMs,
    });

    if (this.resumeTimeout) {
      clearTimeout(this.resumeTimeout);
    }

    this.resumeTimeout = setTimeout(() => {
      this.resumeFromQuota(rName);
    }, waitMs);
  }

  public resumeFromQuota(runnerName?: string): void {
    const targetRunner = runnerName ? runnerName.toLowerCase() : undefined;

    if (targetRunner) {
      this.pausedRunners.delete(targetRunner);
    } else {
      this.pausedRunners.clear();
    }

    // Send SIGCONT to resume frozen child PIDs of this runner
    for (const [pid, runner] of this.activePids.entries()) {
      if (!targetRunner || runner === targetRunner) {
        try {
          process.kill(pid, 'SIGCONT');
        } catch {
          // Process might have terminated
        }
      }
    }

    if (this.pausedRunners.size === 0) {
      if (this.resumeTimeout) {
        clearTimeout(this.resumeTimeout);
        this.resumeTimeout = undefined;
      }

      const previousResetAt = this.resetAt;
      this.isPaused = false;
      this.pausedAt = undefined;
      this.resetAt = undefined;
      this.pauseReason = undefined;

      this.emit('quota_resumed', { resumedAt: new Date(), previousResetAt, runnerName: targetRunner });
    } else {
      // Pick the next soonest reset among remaining paused runners
      const nextPaused = Array.from(this.pausedRunners.values()).sort(
        (a, b) => a.resetAt.getTime() - b.resetAt.getTime()
      )[0];
      this.resetAt = nextPaused.resetAt;
      this.pauseReason = nextPaused.reason;
    }
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

  public async fetchLiveUsage(forceRefresh = false): Promise<ClaudeLiveUsage | null> {
    for (const [name, provider] of this.providers.entries()) {
      try {
        const isAvailable = provider.isAvailable ? await provider.isAvailable() : true;
        if (!isAvailable) {
          this.runnerUsages.delete(name);
          continue;
        }

        const usage = await provider.fetchUsage(forceRefresh);
        if (usage) {
          this.runnerUsages.set(name, usage);
        }
      } catch {
        // Individual provider failure is non-fatal
      }
    }

    const claudeLive = (await this.claudeProvider.isAvailable()) ? this.claudeProvider.getCachedLiveUsage() : null;

    // Check if Claude 5h limit is reached
    if (claudeLive && claudeLive.sessionUsedPercentage >= 100 && claudeLive.sessionResetAt) {
      if (!this.isRunnerPaused('claude')) {
        this.triggerQuotaPause(claudeLive.sessionResetAt, `Claude Live Session Quota: 100% used (resets ${claudeLive.sessionResetText})`, 'claude');
      }
    } else if (this.isRunnerPaused('claude') && claudeLive && claudeLive.sessionUsedPercentage < 100) {
      this.resumeFromQuota('claude');
    }

    // Check if AGY 5h limit is reached
    const agyUsage = this.runnerUsages.get('agy');
    if (agyUsage) {
      const fiveHourBucket = agyUsage.buckets.find((b) => b.windowType === 'five_hour' && b.usedPercentage >= 100);
      if (fiveHourBucket && fiveHourBucket.resetAt) {
        if (!this.isRunnerPaused('agy')) {
          this.triggerQuotaPause(fiveHourBucket.resetAt, `AGY Quota: 100% used for ${fiveHourBucket.name}`, 'agy');
        }
      } else if (this.isRunnerPaused('agy')) {
        this.resumeFromQuota('agy');
      }
    }

    return claudeLive;
  }

  public getStatus(utilizationThreshold: number = 0.85, customCeiling?: number): QuotaStatus {
    const rollingStats = this.scanRollingWindowUsage(utilizationThreshold, customCeiling);
    const runnerUsageRecord: Record<string, RunnerLiveUsage> = {};
    for (const [key, value] of this.runnerUsages.entries()) {
      runnerUsageRecord[key] = value;
    }

    const pausedRunnersRecord: Record<string, RunnerPauseInfo> = {};
    for (const [key, value] of this.pausedRunners.entries()) {
      pausedRunnersRecord[key] = value;
    }

    const pausedKeys = Array.from(this.pausedRunners.keys());
    const pausedRunner = pausedKeys.length > 0 ? pausedKeys.join(', ') : undefined;

    return {
      isPaused: this.pausedRunners.size > 0,
      pausedAt: this.pausedAt,
      resetAt: this.resetAt,
      reason: this.pauseReason,
      pausedRunner,
      pausedRunners: Object.keys(pausedRunnersRecord).length > 0 ? pausedRunnersRecord : undefined,
      activePids: Array.from(this.activePids.keys()),
      rollingStats,
      liveUsage: this.claudeProvider.getCachedLiveUsage() || undefined,
      runnerUsage: Object.keys(runnerUsageRecord).length > 0 ? runnerUsageRecord : undefined,
    };
  }

  public getRemainingPauseTimeMs(): number {
    if (!this.isPaused || !this.resetAt) return 0;
    return Math.max(0, this.resetAt.getTime() - Date.now());
  }
}
