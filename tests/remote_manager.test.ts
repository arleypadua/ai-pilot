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
  public textReplyHandlers: Array<(replyToMessageId: number, text: string, userId: number) => Promise<void>> = [];

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

  public onTextReply(
    handler: (replyToMessageId: number, text: string, userId: number) => Promise<void>
  ): void {
    this.textReplyHandlers.push(handler);
  }

  public async triggerAction(
    payload: string,
    userId: number = 123,
    context?: ActionContext
  ): Promise<void> {
    for (const [prefix, handler] of this.actionHandlers.entries()) {
      if (payload.startsWith(prefix)) {
        await handler(prefix, payload, userId, context);
        break;
      }
    }
  }

  public async triggerTextReply(
    replyToMessageId: number,
    text: string,
    userId: number = 12345
  ): Promise<void> {
    for (const handler of this.textReplyHandlers) {
      await handler(replyToMessageId, text, userId);
    }
  }
}

class MockActionController implements RemoteActionController {
  public resumedRunners: Array<string | undefined> = [];
  public pausedTasks: number[] = [];
  public resumedTasks: number[] = [];
  public repliedNeedsInfo: Array<{ issueNumber: number; answer: string }> = [];
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
    this.repliedNeedsInfo.push({ issueNumber, answer });
  }

  public setTargetSpecs(specs: number[]): void {
    this.targetSpecs.push(specs);
  }

  public getStatusSummary(): unknown {
    return { status: 'running' };
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

  describe('needs-info dual-mode interactive steering', () => {
    it('automatically parses multiple-choice options and includes GitHub link button', async () => {
      manager = new RemoteControlManager({
        provider,
        repository: 'arleypadua/imagos',
        defaultChatId: 123456,
        actionController,
      });

      await manager.start();

      const question = `Which runner strategy should we use for this task?
1. Claude 3.7 Sonnet
2. Antigravity Agent (AGY)
3. Fallback Hybrid`;

      Notifier.notifyNeedsFeedback(
        26,
        'feat: remote needs-info steering',
        question,
        'https://github.com/arleypadua/imagos/pull/35',
        35
      );
      await new Promise((r) => setTimeout(r, 10));

      expect(provider.sentMessages.length).toBe(1);
      const msg = provider.sentMessages[0];
      expect(msg.text).toContain('Which runner strategy should we use for this task?');
      expect(msg.options?.actions).toBeDefined();

      const actions = msg.options!.actions!;
      // 3 choice buttons + 1 GitHub PR link button
      expect(actions.length).toBe(4);
      expect(actions[0][0].label).toBe('Claude 3.7 Sonnet');
      expect(actions[0][0].payload).toBe('v1:inf:26:0');
      expect(actions[1][0].label).toBe('Antigravity Agent (AGY)');
      expect(actions[1][0].payload).toBe('v1:inf:26:1');
      expect(actions[2][0].label).toBe('Fallback Hybrid');
      expect(actions[2][0].payload).toBe('v1:inf:26:2');
      expect(actions[3][0].label).toBe('🔗 Open on GitHub');
      expect(actions[3][0].url).toBe('https://github.com/arleypadua/imagos/pull/35');
    });

    it('handles option button click: acknowledges query, edits message with selection, removes buttons, and invokes actionController', async () => {
      manager = new RemoteControlManager({
        provider,
        repository: 'arleypadua/imagos',
        defaultChatId: 123456,
        actionController,
      });

      await manager.start();

      const question = `Which database should we use?
1. PostgreSQL
2. SQLite`;

      Notifier.notifyNeedsFeedback(26, 'feat: db migration', question);
      await new Promise((r) => setTimeout(r, 10));

      // Trigger button click on option 0 (PostgreSQL)
      await provider.triggerAction('v1:inf:26:0', 999);

      // Verify actionController received reply
      expect(actionController.repliedNeedsInfo.length).toBe(1);
      expect(actionController.repliedNeedsInfo[0]).toEqual({
        issueNumber: 26,
        answer: 'PostgreSQL',
      });

      // Verify message was edited to show selected choice and remove buttons
      expect(provider.editedMessages.length).toBe(1);
      const edited = provider.editedMessages[0];
      expect(edited.messageId).toBe(1);
      expect(edited.text).toContain('✅ *Answered* (via button): PostgreSQL');
      expect(edited.options?.actions).toEqual([]);

      // Second click on the same issue is ignored (locked message)
      await provider.triggerAction('v1:inf:26:1', 999);
      expect(actionController.repliedNeedsInfo.length).toBe(1);
      expect(provider.editedMessages.length).toBe(1);
    });

    it('handles swipe-to-reply text response: maps message ID to issue, edits message with reply, removes buttons, and invokes actionController', async () => {
      manager = new RemoteControlManager({
        provider,
        repository: 'arleypadua/imagos',
        defaultChatId: 123456,
        actionController,
      });

      await manager.start();

      Notifier.notifyNeedsFeedback(
        42,
        'feat: custom configuration',
        'What should the port number and timeout be?'
      );
      await new Promise((r) => setTimeout(r, 10));

      const messageId = provider.sentMessages.length; // Message ID is 1

      // Developer swipes to reply to messageId 1
      await provider.triggerTextReply(messageId, 'Use port 8080 and 30s timeout', 999);

      // Verify actionController received reply
      expect(actionController.repliedNeedsInfo.length).toBe(1);
      expect(actionController.repliedNeedsInfo[0]).toEqual({
        issueNumber: 42,
        answer: 'Use port 8080 and 30s timeout',
      });

      // Verify message was edited to show text reply and lock buttons
      expect(provider.editedMessages.length).toBe(1);
      const edited = provider.editedMessages[0];
      expect(edited.messageId).toBe(messageId);
      expect(edited.text).toContain('✅ *Answered* (via text): Use port 8080 and 30s timeout');
      expect(edited.options?.actions).toEqual([]);

      // Second reply to the same message is ignored
      await provider.triggerTextReply(messageId, 'Another reply', 999);
      expect(actionController.repliedNeedsInfo.length).toBe(1);
      expect(provider.editedMessages.length).toBe(1);
    });

    it('ignores text replies to unknown message IDs', async () => {
      manager = new RemoteControlManager({
        provider,
        repository: 'arleypadua/imagos',
        defaultChatId: 123456,
        actionController,
      });

      await manager.start();

      // Swipe to reply to an unknown message ID (e.g. 9999)
      await provider.triggerTextReply(9999, 'Some reply', 123);

      expect(actionController.repliedNeedsInfo.length).toBe(0);
      expect(provider.editedMessages.length).toBe(0);
    });
  });
});

