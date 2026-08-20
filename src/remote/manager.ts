import type {
  RemoteControlProvider,
  RemoteActionController,
  RemoteControlManagerOptions,
  RemoteMessageOptions,
  TaskStartedNotificationPayload,
  TaskCompletedNotificationPayload,
  SpecCompletedNotificationPayload,
  NeedsInfoNotificationPayload,
  QuotaPausedNotificationPayload,
  QuotaResumedNotificationPayload,
} from './types.js';
import type { TelegramNotificationsConfig } from '../types/index.js';
import { AgentEventBus, type AgentEvent } from '../events/bus.js';
import { Notifier } from '../notifications/notifier.js';
import {
  formatTaskStarted,
  formatTaskCompleted,
  formatSpecCompleted,
  formatNeedsInfo,
  formatQuotaPaused,
  formatQuotaResumed,
} from './formatters.js';

export class RemoteControlManager {
  private provider: RemoteControlProvider;
  private repository?: string;
  private defaultChatId?: number | string;
  private notifications: TelegramNotificationsConfig & { taskStarted?: boolean };
  private eventBus: AgentEventBus;
  private actionController?: RemoteActionController;
  private isStarted: boolean = false;

  private boundOnTaskStarted: (payload: TaskStartedNotificationPayload) => void;
  private boundOnTaskCompleted: (payload: TaskCompletedNotificationPayload) => void;
  private boundOnSpecCompleted: (payload: SpecCompletedNotificationPayload) => void;
  private boundOnNeedsInfo: (payload: NeedsInfoNotificationPayload) => void;
  private boundOnQuotaPaused: (payload: QuotaPausedNotificationPayload) => void;
  private boundOnQuotaResumed: (payload: QuotaResumedNotificationPayload) => void;
  private boundOnAgentEvent: (event: AgentEvent) => void;

  constructor(options: RemoteControlManagerOptions) {
    this.provider = options.provider;
    this.repository = options.repository;
    this.defaultChatId = options.defaultChatId;
    this.notifications = {
      needsInfo: options.notifications?.needsInfo ?? true,
      quotaPaused: options.notifications?.quotaPaused ?? true,
      taskCompleted: options.notifications?.taskCompleted ?? true,
      specCompleted: options.notifications?.specCompleted ?? true,
      taskStarted: (options.notifications as any)?.taskStarted ?? true,
      ...options.notifications,
    };
    this.eventBus = options.eventBus ?? AgentEventBus.getInstance();
    this.actionController = options.actionController;

    this.boundOnTaskStarted = (payload) => {
      this.handleTaskStarted(payload).catch((err) => {
        console.error('RemoteControlManager error handling task_started:', err);
      });
    };
    this.boundOnTaskCompleted = (payload) => {
      this.handleTaskCompleted(payload).catch((err) => {
        console.error('RemoteControlManager error handling task_completed:', err);
      });
    };
    this.boundOnSpecCompleted = (payload) => {
      this.handleSpecCompleted(payload).catch((err) => {
        console.error('RemoteControlManager error handling spec_completed:', err);
      });
    };
    this.boundOnNeedsInfo = (payload) => {
      this.handleNeedsInfo(payload).catch((err) => {
        console.error('RemoteControlManager error handling needs_info:', err);
      });
    };
    this.boundOnQuotaPaused = (payload) => {
      this.handleQuotaPaused(payload).catch((err) => {
        console.error('RemoteControlManager error handling quota_paused:', err);
      });
    };
    this.boundOnQuotaResumed = (payload) => {
      this.handleQuotaResumed(payload).catch((err) => {
        console.error('RemoteControlManager error handling quota_resumed:', err);
      });
    };
    this.boundOnAgentEvent = (event) => {
      this.handleAgentEvent(event);
    };
  }

  public getProvider(): RemoteControlProvider {
    return this.provider;
  }

  public getRepository(): string | undefined {
    return this.repository;
  }

  public getDefaultChatId(): number | string | undefined {
    return this.defaultChatId;
  }

  public getNotificationsConfig(): TelegramNotificationsConfig {
    return { ...this.notifications };
  }

  public setActionController(controller: RemoteActionController): void {
    this.actionController = controller;
  }

  public getActionController(): RemoteActionController | undefined {
    return this.actionController;
  }

  public isRunning(): boolean {
    return this.isStarted;
  }

  public async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    Notifier.on('task_started', this.boundOnTaskStarted);
    Notifier.on('task_completed', this.boundOnTaskCompleted);
    Notifier.on('spec_completed', this.boundOnSpecCompleted);
    Notifier.on('needs_info', this.boundOnNeedsInfo);
    Notifier.on('quota_paused', this.boundOnQuotaPaused);
    Notifier.on('quota_resumed', this.boundOnQuotaResumed);

    this.eventBus.on('agent_event', this.boundOnAgentEvent);

    await this.provider.start();
  }

  public async stop(): Promise<void> {
    if (!this.isStarted) return;
    this.isStarted = false;

    Notifier.off('task_started', this.boundOnTaskStarted);
    Notifier.off('task_completed', this.boundOnTaskCompleted);
    Notifier.off('spec_completed', this.boundOnSpecCompleted);
    Notifier.off('needs_info', this.boundOnNeedsInfo);
    Notifier.off('quota_paused', this.boundOnQuotaPaused);
    Notifier.off('quota_resumed', this.boundOnQuotaResumed);

    this.eventBus.off('agent_event', this.boundOnAgentEvent);

    await this.provider.stop();
  }

  public async sendTaskStarted(
    payload: TaskStartedNotificationPayload,
    chatId?: number | string
  ): Promise<{ messageId: number } | undefined> {
    if (this.notifications.taskStarted === false) {
      return undefined;
    }
    const text = formatTaskStarted(this.repository, payload);
    return this.provider.sendMessage(text, {
      chatId: chatId ?? this.defaultChatId,
      parseMode: 'Markdown',
    });
  }

  public async sendTaskCompleted(
    payload: TaskCompletedNotificationPayload,
    chatId?: number | string
  ): Promise<{ messageId: number } | undefined> {
    if (!this.notifications.taskCompleted) {
      return undefined;
    }
    const text = formatTaskCompleted(this.repository, payload);
    return this.provider.sendMessage(text, {
      chatId: chatId ?? this.defaultChatId,
      parseMode: 'Markdown',
    });
  }

  public async sendSpecCompleted(
    payload: SpecCompletedNotificationPayload,
    chatId?: number | string
  ): Promise<{ messageId: number } | undefined> {
    if (!this.notifications.specCompleted) {
      return undefined;
    }
    const text = formatSpecCompleted(this.repository, payload);
    return this.provider.sendMessage(text, {
      chatId: chatId ?? this.defaultChatId,
      parseMode: 'Markdown',
    });
  }

  public async sendNeedsInfo(
    payload: NeedsInfoNotificationPayload,
    options?: RemoteMessageOptions
  ): Promise<{ messageId: number } | undefined> {
    if (!this.notifications.needsInfo) {
      return undefined;
    }
    const text = formatNeedsInfo(this.repository, payload);
    return this.provider.sendMessage(text, {
      chatId: options?.chatId ?? this.defaultChatId,
      parseMode: options?.parseMode ?? 'Markdown',
      actions: options?.actions,
      replyToMessageId: options?.replyToMessageId,
    });
  }

  public async sendQuotaPaused(
    payload: QuotaPausedNotificationPayload,
    chatId?: number | string
  ): Promise<{ messageId: number } | undefined> {
    if (!this.notifications.quotaPaused) {
      return undefined;
    }
    const text = formatQuotaPaused(this.repository, payload);
    return this.provider.sendMessage(text, {
      chatId: chatId ?? this.defaultChatId,
      parseMode: 'Markdown',
    });
  }

  public async sendQuotaResumed(
    payload: QuotaResumedNotificationPayload,
    chatId?: number | string
  ): Promise<{ messageId: number } | undefined> {
    if (!this.notifications.quotaPaused) {
      return undefined;
    }
    const text = formatQuotaResumed(this.repository, payload);
    return this.provider.sendMessage(text, {
      chatId: chatId ?? this.defaultChatId,
      parseMode: 'Markdown',
    });
  }

  public async sendMessage(
    text: string,
    options?: RemoteMessageOptions
  ): Promise<{ messageId: number }> {
    return this.provider.sendMessage(text, {
      chatId: options?.chatId ?? this.defaultChatId,
      ...options,
    });
  }

  private async handleTaskStarted(payload: TaskStartedNotificationPayload): Promise<void> {
    await this.sendTaskStarted(payload);
  }

  private async handleTaskCompleted(payload: TaskCompletedNotificationPayload): Promise<void> {
    await this.sendTaskCompleted(payload);
  }

  private async handleSpecCompleted(payload: SpecCompletedNotificationPayload): Promise<void> {
    await this.sendSpecCompleted(payload);
  }

  private async handleNeedsInfo(payload: NeedsInfoNotificationPayload): Promise<void> {
    await this.sendNeedsInfo(payload);
  }

  private async handleQuotaPaused(payload: QuotaPausedNotificationPayload): Promise<void> {
    await this.sendQuotaPaused(payload);
  }

  private async handleQuotaResumed(payload: QuotaResumedNotificationPayload): Promise<void> {
    await this.sendQuotaResumed(payload);
  }

  private handleAgentEvent(_event: AgentEvent): void {
    // AgentEventBus hook for potential event forwarding or logging
  }
}
