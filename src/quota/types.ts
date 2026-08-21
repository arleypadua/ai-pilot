export type QuotaWindowType = 'five_hour' | 'weekly' | 'daily' | 'session' | 'other';

export interface QuotaBucket {
  name: string;
  group: string;
  windowType: QuotaWindowType;
  usedPercentage: number;
  remainingPercentage?: number;
  resetAt?: Date;
  resetText?: string;
}

export interface RunnerLiveUsage {
  runnerName: string;
  displayName: string;
  buckets: QuotaBucket[];
  lastFetchedAt: Date;
  rawText?: string;
}

export interface UsageProvider {
  readonly name: string;
  readonly displayName: string;
  fetchUsage(forceRefresh?: boolean): Promise<RunnerLiveUsage | null>;
  isAvailable?(): Promise<boolean>;
}

export interface ClaudeLiveUsage {
  sessionUsedPercentage: number;
  sessionResetText?: string;
  sessionResetAt?: Date;
  weekUsedPercentage?: number;
  weekResetText?: string;
  lastFetchedAt: Date;
}

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

export interface RunnerPauseInfo {
  runnerName: string;
  pausedAt: Date;
  resetAt: Date;
  reason: string;
  affectedIssues?: number[];
}

export interface QuotaStatus {
  isPaused: boolean;
  pausedAt?: Date;
  resetAt?: Date;
  reason?: string;
  pausedRunner?: string;
  pausedRunners?: Record<string, RunnerPauseInfo>;
  activePids: number[];
  rollingStats?: RollingWindowStats;
  liveUsage?: ClaudeLiveUsage;
  runnerUsage?: Record<string, RunnerLiveUsage>;
}
