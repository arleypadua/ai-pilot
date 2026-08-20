import type { TelegramNotificationsConfig } from '../types/index.js';
import type { TelegramRateLimiter } from './rate_limiter.js';
import type { AgentEventBus } from '../events/bus.js';
import type { QuotaMonitor } from '../quota/monitor.js';

export interface InteractiveAction {
  id: string; // Action prefix or identifier (e.g. 'v1:inf', 'v1:q')
  label: string; // Button text shown to user
  payload: string; // Callback data payload
  style?: 'primary' | 'danger' | 'default';
  url?: string; // If set, renders as a URL link button rather than callback button
}

export interface ActionContext {
  messageId?: number;
  chatId?: number | string;
  originalText?: string;
}

export interface RemoteMessageOptions {
  chatId?: string | number;
  parseMode?: 'MarkdownV2' | 'Markdown' | 'HTML';
  actions?: InteractiveAction[][]; // Rows of inline keyboard buttons
  replyToMessageId?: number;
}

export interface RemoteControlProvider {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(text: string, options?: RemoteMessageOptions): Promise<{ messageId: number }>;
  editMessage(messageId: number, text: string, options?: RemoteMessageOptions): Promise<void>;
  onAction(
    actionPrefix: string,
    handler: (action: string, payload: string, userId: number, context?: ActionContext) => Promise<void>
  ): void;
  onTextReply?(handler: (replyToMessageId: number, text: string, userId: number) => Promise<void>): void;
  onCommand?(command: string, handler: (args: string[], userId: number) => Promise<void>): void;
}

export interface RemoteActionController {
  replyToNeedsInfo(issueNumber: number, answer: string): Promise<void>;
  resumeQuota(runner?: string): void;
  pauseTask(issueNumber: number): Promise<void>;
  resumeTask(issueNumber: number): Promise<void>;
  setTargetSpecs(specs: number[]): void;
  getStatusSummary(): unknown;
}

export interface TaskStartedNotificationPayload {
  issueNumber: number;
  issueTitle: string;
  runnerName: string;
  branchName: string;
  sessionId?: string;
  isContinuation?: boolean;
}

export interface TaskCompletedNotificationPayload {
  issueNumber: number;
  issueTitle: string;
  prNumber?: number;
  prUrl?: string;
  baseBranch?: string;
}

export interface SpecCompletedNotificationPayload {
  specNumber: number;
  specTitle: string;
}

export interface NeedsInfoNotificationPayload {
  issueNumber: number;
  issueTitle: string;
  question?: string;
  prNumber?: number;
  prUrl?: string;
}

export interface QuotaPausedNotificationPayload {
  resetAt: Date;
  waitMinutes: number;
  runnerName?: string;
}

export interface QuotaResumedNotificationPayload {
  runnerName?: string;
}

export interface TelegramRemoteProviderOptions {
  botToken?: string;
  allowedUserIds?: number[];
  defaultChatId?: number | string;
  rateLimiter?: TelegramRateLimiter;
  bot?: any;
  autoRetryOptions?: any;
}

export interface RemoteControlManagerOptions {
  provider: RemoteControlProvider;
  repository?: string;
  defaultChatId?: number | string;
  notifications?: Partial<TelegramNotificationsConfig>;
  eventBus?: AgentEventBus;
  actionController?: RemoteActionController;
  quotaMonitor?: QuotaMonitor;
}

