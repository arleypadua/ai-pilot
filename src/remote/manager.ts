import type {
  RemoteControlProvider,
  RemoteActionController,
  RemoteControlManagerOptions,
  RemoteMessageOptions,
  InteractiveAction,
  ActionContext,
  ActiveNeedsInfoRecord,
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
  formatNeedsInfoAnswered,
  formatQuotaPaused,
  formatQuotaResumed,
  formatQuotaResumedByDeveloper,
  buildQuotaResumeCallbackData,
  parseQuotaActionPayload,
  parseQuestionChoices,
} from './formatters.js';
import type { QuotaMonitor } from '../quota/monitor.js';

export interface SendQuotaPausedOptions extends RemoteMessageOptions {
  actions?: InteractiveAction[][];
}

export class RemoteControlManager {
  private provider: RemoteControlProvider;
  private repository?: string;
  private defaultChatId?: number | string;
  private notifications: TelegramNotificationsConfig & { taskStarted?: boolean };
  private eventBus: AgentEventBus;
  private actionController?: RemoteActionController;
  private quotaMonitor?: QuotaMonitor;
  private isStarted: boolean = false;

  private processedQuotaActions = new Set<string>();
  private lastPausedEvent?: { resetAt: number; runner?: string; timestamp: number };
  private lastResumedEvent?: { runner?: string; timestamp: number };
  private messageNeedsInfo: Map<number, ActiveNeedsInfoRecord> = new Map();
  private issueNeedsInfo: Map<number, ActiveNeedsInfoRecord> = new Map();

  private boundOnTaskStarted: (payload: TaskStartedNotificationPayload) => void;
  private boundOnTaskCompleted: (payload: TaskCompletedNotificationPayload) => void;
  private boundOnSpecCompleted: (payload: SpecCompletedNotificationPayload) => void;
  private boundOnNeedsInfo: (payload: NeedsInfoNotificationPayload) => void;
  private boundOnQuotaPaused: (payload: QuotaPausedNotificationPayload) => void;
  private boundOnQuotaResumed: (payload: QuotaResumedNotificationPayload) => void;
  private boundOnQuotaMonitorPaused?: (event: any) => void;
  private boundOnQuotaMonitorResumed?: (event: any) => void;
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
    this.quotaMonitor = options.quotaMonitor;

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
    if (this.quotaMonitor) {
      this.boundOnQuotaMonitorPaused = ({ resetAt, waitMs, runnerName }: any) => {
        const waitMinutes = Math.ceil(
          (waitMs ?? (resetAt ? Math.max(1000, new Date(resetAt).getTime() - Date.now()) : 60000)) /
            (60 * 1000)
        );
        this.handleQuotaPaused({ resetAt: new Date(resetAt), waitMinutes, runnerName }).catch((err) => {
          console.error('RemoteControlManager error handling quota_monitor paused:', err);
        });
      };
      this.boundOnQuotaMonitorResumed = ({ runnerName }: any) => {
        this.handleQuotaResumed({ runnerName }).catch((err) => {
          console.error('RemoteControlManager error handling quota_monitor resumed:', err);
        });
      };
    }
    this.boundOnAgentEvent = (event) => {
      this.handleAgentEvent(event);
    };

    this.setupProviderListeners();
  }

  private setupProviderListeners(): void {
    // Register quota action handler with provider
    this.provider.onAction('v1:q', async (_action, payload, userId, context) => {
      await this.handleQuotaAction(payload, userId, context);
    });

    // Register needs-info action handler with provider
    this.provider.onAction('v1:inf', async (_action, payload, userId) => {
      await this.handleNeedsInfoAction(payload, userId);
    });

    if (this.provider.onTextReply) {
      this.provider.onTextReply(async (replyToMessageId, text, userId) => {
        await this.handleTextReply(replyToMessageId, text, userId);
      });
    }
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

  public getActiveNeedsInfo(issueNumber: number): ActiveNeedsInfoRecord | undefined {
    return this.issueNeedsInfo.get(issueNumber);
  }

  public getActiveNeedsInfoByMessageId(messageId: number): ActiveNeedsInfoRecord | undefined {
    return this.messageNeedsInfo.get(messageId);
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

    if (this.quotaMonitor && this.boundOnQuotaMonitorPaused && this.boundOnQuotaMonitorResumed) {
      this.quotaMonitor.on('quota_paused', this.boundOnQuotaMonitorPaused);
      this.quotaMonitor.on('quota_resumed', this.boundOnQuotaMonitorResumed);
    }

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

    if (this.quotaMonitor && this.boundOnQuotaMonitorPaused && this.boundOnQuotaMonitorResumed) {
      this.quotaMonitor.off('quota_paused', this.boundOnQuotaMonitorPaused);
      this.quotaMonitor.off('quota_resumed', this.boundOnQuotaMonitorResumed);
    }

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
    const targetChatId = options?.chatId ?? this.defaultChatId;

    let actions = options?.actions;
    const choices = payload.choices && payload.choices.length > 0
      ? payload.choices
      : parseQuestionChoices(payload.question);

    if (!actions) {
      const generatedActions: InteractiveAction[][] = [];
      if (choices.length > 0) {
        for (let i = 0; i < choices.length; i++) {
          const choice = choices[i];
          const cleanLabel = choice.replace(/^[\d+a-zA-Z][\.\)]\s*/, '').replace(/[*_`]/g, '').trim();
          const buttonLabel = cleanLabel.length > 35 ? cleanLabel.slice(0, 32) + '...' : cleanLabel;
          generatedActions.push([
            {
              id: `inf_${payload.issueNumber}_${i}`,
              label: buttonLabel,
              payload: `v1:inf:${payload.issueNumber}:${i}`,
            },
          ]);
        }
      }

      const ghUrl = payload.issueUrl || payload.prUrl || (this.repository ? `https://github.com/${this.repository}/issues/${payload.issueNumber}` : undefined);
      if (ghUrl) {
        generatedActions.push([
          {
            id: `gh_${payload.issueNumber}`,
            label: '🔗 Open on GitHub',
            payload: '',
            url: ghUrl,
          },
        ]);
      }

      if (generatedActions.length > 0) {
        actions = generatedActions;
      }
    }

    const res = await this.provider.sendMessage(text, {
      chatId: targetChatId,
      parseMode: options?.parseMode ?? 'Markdown',
      actions,
      replyToMessageId: options?.replyToMessageId,
    });

    const record: ActiveNeedsInfoRecord = {
      issueNumber: payload.issueNumber,
      messageId: res.messageId,
      chatId: targetChatId,
      payload,
      choices,
      originalText: text,
      answered: false,
      createdAt: Date.now(),
    };

    this.messageNeedsInfo.set(res.messageId, record);
    this.issueNeedsInfo.set(payload.issueNumber, record);

    return res;
  }

  public async handleNeedsInfoAction(payload: string, userId: number): Promise<void> {
    const parts = payload.split(':');
    if (parts.length < 4) {
      return;
    }
    const issueNumber = parseInt(parts[2], 10);
    const choiceKey = parts.slice(3).join(':');

    if (isNaN(issueNumber)) {
      return;
    }

    const activeInfo = this.issueNeedsInfo.get(issueNumber);
    if (activeInfo && activeInfo.answered) {
      return; // Already answered
    }

    let answerText = choiceKey;
    const choiceIndex = parseInt(choiceKey, 10);
    if (!isNaN(choiceIndex) && activeInfo && activeInfo.choices && activeInfo.choices[choiceIndex] !== undefined) {
      answerText = activeInfo.choices[choiceIndex];
    }

    if (activeInfo) {
      activeInfo.answered = true;
      activeInfo.selectedAnswer = answerText;

      const updatedText = formatNeedsInfoAnswered(
        this.repository,
        activeInfo.payload,
        answerText,
        'button'
      );

      try {
        await this.provider.editMessage(activeInfo.messageId, updatedText, {
          chatId: activeInfo.chatId ?? this.defaultChatId,
          actions: [],
        });
      } catch (err: any) {
        console.error(`RemoteControlManager: failed to edit message #${activeInfo.messageId}:`, err);
      }
    }

    if (this.actionController) {
      try {
        await this.actionController.replyToNeedsInfo(issueNumber, answerText);
      } catch (err: any) {
        console.error(`RemoteControlManager: error in replyToNeedsInfo for issue #${issueNumber}:`, err);
      }
    }
  }

  public async handleTextReply(replyToMessageId: number, text: string, userId: number): Promise<void> {
    const activeInfo = this.messageNeedsInfo.get(replyToMessageId);
    if (!activeInfo) {
      return;
    }

    if (activeInfo.answered) {
      return; // Already answered
    }

    activeInfo.answered = true;
    activeInfo.selectedAnswer = text;

    const updatedText = formatNeedsInfoAnswered(
      this.repository,
      activeInfo.payload,
      text,
      'text'
    );

    try {
      await this.provider.editMessage(activeInfo.messageId, updatedText, {
        chatId: activeInfo.chatId ?? this.defaultChatId,
        actions: [],
      });
    } catch (err: any) {
      console.error(`RemoteControlManager: failed to edit message #${activeInfo.messageId}:`, err);
    }

    if (this.actionController) {
      try {
        await this.actionController.replyToNeedsInfo(activeInfo.issueNumber, text);
      } catch (err: any) {
        console.error(`RemoteControlManager: error in replyToNeedsInfo for issue #${activeInfo.issueNumber}:`, err);
      }
    }
  }

  public async sendQuotaPaused(
    payload: QuotaPausedNotificationPayload,
    chatIdOrOptions?: number | string | SendQuotaPausedOptions
  ): Promise<{ messageId: number } | undefined> {
    if (!this.notifications.quotaPaused) {
      return undefined;
    }
    const text = formatQuotaPaused(this.repository, payload);
    const chatId = typeof chatIdOrOptions === 'object' ? chatIdOrOptions.chatId : chatIdOrOptions;
    const customActions = typeof chatIdOrOptions === 'object' ? chatIdOrOptions.actions : undefined;
    const actions: InteractiveAction[][] = customActions ?? [
      [
        {
          id: 'v1:q',
          label: '⚡ Resume Immediately',
          payload: buildQuotaResumeCallbackData(payload.runnerName),
        },
      ],
    ];

    return this.provider.sendMessage(text, {
      chatId: chatId ?? this.defaultChatId,
      parseMode: 'Markdown',
      actions,
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

  public async handleQuotaAction(
    payload: string,
    userId: number,
    context?: ActionContext
  ): Promise<boolean> {
    const parsed = parseQuotaActionPayload(payload);
    if (!parsed) {
      return false;
    }

    const idempotencyKey = context?.messageId
      ? `msg:${context.chatId ?? this.defaultChatId}:${context.messageId}`
      : `payload:${payload}:${userId}`;

    if (this.processedQuotaActions.has(idempotencyKey)) {
      return false;
    }
    this.processedQuotaActions.add(idempotencyKey);

    if (this.actionController) {
      this.actionController.resumeQuota(parsed.runner);
    }

    if (context?.messageId) {
      const updatedText = formatQuotaResumedByDeveloper(this.repository, {
        originalText: context.originalText,
        timestamp: new Date(),
        runnerName: parsed.runner,
      });
      try {
        await this.provider.editMessage(context.messageId, updatedText, {
          chatId: context.chatId ?? this.defaultChatId,
          parseMode: 'Markdown',
          actions: [],
        });
      } catch (err: any) {
        console.error('Failed to edit message inline on quota resume:', err);
      }
    }

    return true;
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
    const now = Date.now();
    const resetAtMs = payload.resetAt ? new Date(payload.resetAt).getTime() : 0;
    if (
      this.lastPausedEvent &&
      this.lastPausedEvent.resetAt === resetAtMs &&
      this.lastPausedEvent.runner === payload.runnerName &&
      now - this.lastPausedEvent.timestamp < 2000
    ) {
      return;
    }
    this.lastPausedEvent = { resetAt: resetAtMs, runner: payload.runnerName, timestamp: now };
    await this.sendQuotaPaused(payload);
  }

  private async handleQuotaResumed(payload: QuotaResumedNotificationPayload): Promise<void> {
    const now = Date.now();
    if (
      this.lastResumedEvent &&
      this.lastResumedEvent.runner === payload.runnerName &&
      now - this.lastResumedEvent.timestamp < 2000
    ) {
      return;
    }
    this.lastResumedEvent = { runner: payload.runnerName, timestamp: now };
    await this.sendQuotaResumed(payload);
  }

  private handleAgentEvent(_event: AgentEvent): void {
    // AgentEventBus hook for potential event forwarding or logging
  }
}

