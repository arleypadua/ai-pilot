import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RemoteControlManager } from '../src/remote/manager.js';
import type {
  RemoteControlProvider,
  RemoteMessageOptions,
  RemoteActionController,
  ActionContext,
} from '../src/remote/types.js';
import { Notifier } from '../src/notifications/notifier.js';
import { AgentEventBus } from '../src/events/bus.js';
import { QuotaMonitor } from '../src/quota/monitor.js';

class MockRemoteProvider implements RemoteControlProvider {
  public readonly name = 'mock';
  public isStarted = false;
  public sentMessages: Array<{ text: string; options?: RemoteMessageOptions }> = [];
  public editedMessages: Array<{ messageId: number; text: string; options?: RemoteMessageOptions }> = [];
  public actionHandlers: Map<
    string,
    (action: string, payload: string, userId: number, context?: ActionContext) => Promise<void>
  > = new Map();

  public async start(): Promise<void> {
    this.isStarted = true;
  }

  public async stop(): Promise<void> {
    this.isStarted = false;
  }

  public async sendMessage(
    text: string,
    options?: RemoteMessageOptions
  ): Promise<{ messageId: number }> {
    this.sentMessages.push({ text, options });
    return { messageId: this.sentMessages.length };
  }

  public async editMessage(
    messageId: number,
    text: string,
    options?: RemoteMessageOptions
  ): Promise<void> {
    this.editedMessages.push({ messageId, text, options });
  }

  public onAction(
    actionPrefix: string,
    handler: (action: string, payload: string, userId: number, context?: ActionContext) => Promise<void>
  ): void {
    this.actionHandlers.set(actionPrefix, handler);
  }

  public async triggerAction(
    payload: string,
    userId: number = 123,
    context?: ActionContext
  ): Promise<void> {
    for (const [prefix, handler] of this.actionHandlers.entries()) {
      if (payload.startsWith(prefix)) {
        await handler(prefix, payload, userId, context);
      }
    }
  }
}

class MockActionController implements RemoteActionController {
  public resumedRunners: Array<string | undefined> = [];
  public pausedTasks: number[] = [];
  public resumedTasks: number[] = [];
  public replies: Array<{ issueNumber: number; answer: string }> = [];
  public targetSpecs: number[][] = [];

  public resumeQuota(runner?: string): void {
    this.resumedRunners.push(runner);
  }

  public async pauseTask(issueNumber: number): Promise<void> {
    this.pausedTasks.push(issueNumber);
  }

  public async resumeTask(issueNumber: number): Promise<void> {
    this.resumedTasks.push(issueNumber);
  }

  public async replyToNeedsInfo(issueNumber: number, answer: string): Promise<void> {
    this.replies.push({ issueNumber, answer });
  }

  public setTargetSpecs(specs: number[]): void {
    this.targetSpecs.push(specs);
  }

  public getStatusSummary(): unknown {
    return { mock: true };
  }
}

describe('RemoteControlManager', () => {
  let provider: MockRemoteProvider;
  let actionController: MockActionController;
  let manager: RemoteControlManager;
  let eventBus: AgentEventBus;

  beforeEach(() => {
    Notifier.removeAllListeners();
    provider = new MockRemoteProvider();
    actionController = new MockActionController();
    eventBus = AgentEventBus.getInstance();
    eventBus.clearHistory();
  });

  afterEach(async () => {
    if (manager) {
      await manager.stop();
    }
    Notifier.removeAllListeners();
  });

  it('subscribes to Notifier events and dispatches formatted alerts tagged with [owner/repo]', async () => {
    manager = new RemoteControlManager({
      provider,
      repository: 'arleypadua/imagos',
      defaultChatId: 123456,
      eventBus,
      actionController,
    });

    await manager.start();
    expect(provider.isStarted).toBe(true);

    // 1. Task Started
    Notifier.notifyTaskStarted({
      issueNumber: 24,
      issueTitle: 'feat: outbound milestone notifications',
      runnerName: 'agy',
      branchName: 'agent/issue-24',
      sessionId: 'session-123',
    });

    expect(provider.sentMessages.length).toBe(1);
    expect(provider.sentMessages[0].options?.chatId).toBe(123456);
    expect(provider.sentMessages[0].text).toContain('[arleypadua/imagos] 🤖 *Task Started*: #24');
    expect(provider.sentMessages[0].text).toContain('• *Runner*: `agy`');

    // 2. Task Completed & Merged
    Notifier.notifyTaskMerged(
      24,
      'feat: outbound milestone notifications',
      'https://github.com/arleypadua/imagos/pull/30',
      30,
      'main'
    );

    expect(provider.sentMessages.length).toBe(2);
    expect(provider.sentMessages[1].text).toContain('[arleypadua/imagos] 🎉 *Task Completed & Merged*: #24');
    expect(provider.sentMessages[1].text).toContain('• *Pull Request*: [PR #30]');

    // 3. Spec Completed
    Notifier.notifySpecComplete(22, 'Spec: Extensible Remote Control');

    expect(provider.sentMessages.length).toBe(3);
    expect(provider.sentMessages[2].text).toContain('[arleypadua/imagos] 🏆 *Spec Complete*: #22');

    // 4. Needs Info / Feedback Needed
    Notifier.notifyNeedsFeedback(
      24,
      'feat: outbound milestone notifications',
      'Should we enable auto-retry by default?',
      'https://github.com/arleypadua/imagos/pull/30',
      30
    );

    expect(provider.sentMessages.length).toBe(4);
    expect(provider.sentMessages[3].text).toContain('[arleypadua/imagos] ❓ *Feedback Needed*: #24');
    expect(provider.sentMessages[3].text).toContain('Should we enable auto-retry by default?');

    // 5. Quota Paused (includes inline [⚡ Resume Immediately] action button)
    const resetTime = new Date('2026-08-20T19:00:00Z');
    Notifier.notifyQuotaPaused(resetTime, 45, 'claude');

    expect(provider.sentMessages.length).toBe(5);
    expect(provider.sentMessages[4].text).toContain('[arleypadua/imagos] ⏳ *Quota Limit Reached*');
    expect(provider.sentMessages[4].text).toContain('• *Runner*: `claude`');
    expect(provider.sentMessages[4].options?.actions).toBeDefined();
    expect(provider.sentMessages[4].options?.actions?.[0][0].label).toBe('⚡ Resume Immediately');
    expect(provider.sentMessages[4].options?.actions?.[0][0].payload).toBe('v1:q:res:claude');

    // 6. Quota Resumed
    Notifier.notifyQuotaResumed('claude');

    expect(provider.sentMessages.length).toBe(6);
    expect(provider.sentMessages[5].text).toContain('[arleypadua/imagos] ▶️ *Quota Resumed*');
  });

  it('listens to quota_paused and quota_resumed events from QuotaMonitor instance', async () => {
    const quotaMonitor = new QuotaMonitor();

    manager = new RemoteControlManager({
      provider,
      repository: 'arleypadua/imagos',
      defaultChatId: 123456,
      quotaMonitor,
      actionController,
    });

    await manager.start();

    const resetAt = new Date(Date.now() + 30 * 60 * 1000);
    quotaMonitor.triggerQuotaPause(resetAt, '5h session limit reached', 'agy');

    expect(provider.sentMessages.length).toBe(1);
    expect(provider.sentMessages[0].text).toContain('[arleypadua/imagos] ⏳ *Quota Limit Reached*');
    expect(provider.sentMessages[0].text).toContain('• *Runner*: `agy`');
    expect(provider.sentMessages[0].options?.actions?.[0][0].payload).toBe('v1:q:res:agy');

    quotaMonitor.resumeFromQuota('agy');

    expect(provider.sentMessages.length).toBe(2);
    expect(provider.sentMessages[1].text).toContain('[arleypadua/imagos] ▶️ *Quota Resumed*');
  });

  it('invokes RemoteActionController.resumeQuota and edits message inline when resume button is clicked', async () => {
    manager = new RemoteControlManager({
      provider,
      repository: 'arleypadua/imagos',
      defaultChatId: 123456,
      actionController,
    });

    await manager.start();

    const resetTime = new Date('2026-08-20T20:00:00Z');
    await manager.sendQuotaPaused({
      resetAt: resetTime,
      waitMinutes: 45,
      runnerName: 'claude',
    });

    expect(provider.sentMessages.length).toBe(1);
    const originalText = provider.sentMessages[0].text;

    // Simulate clicking the inline [⚡ Resume Immediately] button
    await provider.triggerAction('v1:q:res:claude', 111, {
      messageId: 1,
      chatId: 123456,
      originalText,
    });

    // 1. RemoteActionController was called with runner 'claude'
    expect(actionController.resumedRunners).toEqual(['claude']);

    // 2. Message was edited inline to remove buttons and display resume notice
    expect(provider.editedMessages.length).toBe(1);
    expect(provider.editedMessages[0].messageId).toBe(1);
    expect(provider.editedMessages[0].text).toContain(originalText);
    expect(provider.editedMessages[0].text).toContain('▶️ Resumed by developer at');
    expect(provider.editedMessages[0].options?.actions).toEqual([]);
  });

  it('handles quota resumption for all runners when runner is empty or all', async () => {
    manager = new RemoteControlManager({
      provider,
      repository: 'arleypadua/imagos',
      defaultChatId: 123456,
      actionController,
    });

    await manager.start();

    await provider.triggerAction('v1:q:res:', 111, {
      messageId: 2,
      chatId: 123456,
      originalText: 'Quota reached',
    });

    expect(actionController.resumedRunners).toEqual([undefined]);
    expect(provider.editedMessages.length).toBe(1);
  });

  it('enforces idempotency preventing double clicks on resume button', async () => {
    manager = new RemoteControlManager({
      provider,
      repository: 'arleypadua/imagos',
      defaultChatId: 123456,
      actionController,
    });

    await manager.start();

    const originalText = '[arleypadua/imagos] ⏳ *Quota Limit Reached*';

    // First click
    await provider.triggerAction('v1:q:res:claude', 111, {
      messageId: 10,
      chatId: 123456,
      originalText,
    });

    expect(actionController.resumedRunners).toEqual(['claude']);
    expect(provider.editedMessages.length).toBe(1);

    // Second click on the same message (e.g. rapid double tap or duplicate callback)
    await provider.triggerAction('v1:q:res:claude', 111, {
      messageId: 10,
      chatId: 123456,
      originalText,
    });

    // Still only 1 call to resumeQuota and 1 editMessage call
    expect(actionController.resumedRunners).toEqual(['claude']);
    expect(provider.editedMessages.length).toBe(1);
  });

  it('respects notification toggles to disable specific notifications', async () => {
    manager = new RemoteControlManager({
      provider,
      repository: 'arleypadua/imagos',
      defaultChatId: 123456,
      notifications: {
        taskCompleted: false,
        specCompleted: false,
        needsInfo: false,
        quotaPaused: false,
      },
    });

    await manager.start();

    Notifier.notifyTaskMerged(1, 'task title');
    Notifier.notifySpecComplete(2, 'spec title');
    Notifier.notifyNeedsFeedback(3, 'feedback title');
    Notifier.notifyQuotaPaused(new Date(), 30);
    Notifier.notifyQuotaResumed();

    expect(provider.sentMessages.length).toBe(0);
  });

  it('unsubscribes from all events on stop()', async () => {
    manager = new RemoteControlManager({
      provider,
      repository: 'arleypadua/imagos',
      defaultChatId: 123456,
    });

    await manager.start();
    expect(manager.isRunning()).toBe(true);

    Notifier.notifyTaskStarted({
      issueNumber: 1,
      issueTitle: 'task 1',
      runnerName: 'agy',
      branchName: 'branch-1',
    });
    expect(provider.sentMessages.length).toBe(1);

    await manager.stop();
    expect(manager.isRunning()).toBe(false);
    expect(provider.isStarted).toBe(false);

    Notifier.notifyTaskStarted({
      issueNumber: 2,
      issueTitle: 'task 2',
      runnerName: 'agy',
      branchName: 'branch-2',
    });
    expect(provider.sentMessages.length).toBe(1); // No new message sent
  });

  it('provides direct notification methods (sendTaskStarted, sendNeedsInfo, etc.)', async () => {
    manager = new RemoteControlManager({
      provider,
      repository: 'arleypadua/imagos',
      defaultChatId: 999,
    });

    await manager.sendNeedsInfo(
      {
        issueNumber: 50,
        issueTitle: 'Need config clarification',
        question: 'What is the default port?',
      },
      {
        actions: [
          [
            { id: 'opt1', label: 'Port 8080', payload: 'v1:inf:50:8080' },
            { id: 'opt2', label: 'Port 9876', payload: 'v1:inf:50:9876' },
          ],
        ],
      }
    );

    expect(provider.sentMessages.length).toBe(1);
    expect(provider.sentMessages[0].options?.actions).toBeDefined();
    expect(provider.sentMessages[0].options?.actions?.[0][0].label).toBe('Port 8080');
  });
});
