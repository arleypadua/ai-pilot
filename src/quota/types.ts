export const DEFAULT_RESET_BUFFER_MS = 2 * 60 * 1000; // 2 minute safety margin to avoid premature window wakeups

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

export interface QuotaMonitorOptions {
  pauseOnLimit?: boolean;
  utilizationThresholdLimit?: number;
  utilizationThreshold?: number;
  proxyPort?: number;
  allowedProviders?: string[];
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
  overriddenRunners?: string[];
  activePids: number[];
  liveUsage?: ClaudeLiveUsage;
  runnerUsage?: Record<string, RunnerLiveUsage>;
}
