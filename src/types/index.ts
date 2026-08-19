export type CanonicalLabel =
  | 'ready-for-agent'
  | 'needs-info'
  | 'ready-for-human'
  | 'needs-triage'
  | 'wontfix';

export interface GitHubLabel {
  name: string;
  color?: string;
  description?: string;
}

export interface GitHubComment {
  id: string;
  author: {
    login: string;
  };
  body: string;
  createdAt: string;
  updatedAt?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED';
  labels: GitHubLabel[];
  url: string;
  createdAt: string;
  updatedAt: string;
  comments?: GitHubComment[];
}

export type TaskKind = 'spec' | 'ticket' | 'standalone';

export interface ParsedDependencies {
  blockers: number[];
  parentNumber?: number;
  subTaskNumbers: number[];
  kind: TaskKind;
}

export type TaskStatus =
  | 'pending'
  | 'blocked'
  | 'ready'
  | 'running'
  | 'paused_quota'
  | 'waiting_feedback'
  | 'testing'
  | 'merging'
  | 'completed'
  | 'failed';

export interface DAGNode {
  issue: GitHubIssue;
  kind: TaskKind;
  blockers: number[];
  dependents: number[];
  parentNumber?: number;
  children: number[];
  status: TaskStatus;
}

export interface TaskContext {
  issue: GitHubIssue;
  kind: TaskKind;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  isContinuation?: boolean;
  userFeedback?: string;
}

export interface RunnerResult {
  success: boolean;
  status: 'COMPLETED' | 'NEEDS_INFO' | 'QUOTA_PAUSED' | 'FAILED';
  summary?: string;
  feedbackQuestion?: string;
  error?: string;
  quotaResetAt?: Date;
}

export interface AutoPilotConfig {
  repository?: string;
  targetSpec?: number;
  baseBranch: string;
  maxConcurrency: number;
  pollIntervalSeconds: number;
  runner: 'claude' | 'agy' | 'pi' | 'custom';
  customRunnerCommand?: string;
  autoMerge: boolean;
  mergeMethod: 'squash' | 'merge' | 'rebase';
  cleanupWorktreeOnClose: boolean;
  quota: {
    pauseOnLimit: boolean;
    utilizationThreshold: number;
    tokenCeiling?: number;
    proxyPort?: number;
  };
  labels: {
    readyForAgent: string;
    needsInfo: string;
    readyForHuman: string;
    needsTriage: string;
    wontfix: string;
  };
}
