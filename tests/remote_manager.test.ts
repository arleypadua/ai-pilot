import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RemoteControlManager } from '../src/remote/manager.js';
import type { RemoteControlProvider, RemoteMessageOptions } from '../src/remote/types.js';
import { Notifier } from '../src/notifications/notifier.js';
import { AgentEventBus } from '../src/events/bus.js';

class MockRemoteProvider implements RemoteControlProvider {
  public readonly name = 'mock';
  public isStarted = false;
  public sentMessages: Array<{ text: string; options?: RemoteMessageOptions }> = [];
  public editedMessages: Array<{ messageId: number; text: string; options?: RemoteMessageOptions }> = [];
  private actionHandlers: Map<string, (action: string, payload: string, userId: number) => Promise<void>> = new Map();

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
    handler: (action: string, payload: string, userId: number) => Promise<void>
  ): void {
    this.actionHandlers.set(actionPrefix, handler);
  }
}

describe('RemoteControlManager', () => {
  let provider: MockRemoteProvider;
  let manager: RemoteControlManager;
  let eventBus: AgentEventBus;

  beforeEach(() => {
    Notifier.removeAllListeners();
    provider = new MockRemoteProvider();
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

    // 5. Quota Paused
    const resetTime = new Date('2026-08-20T19:00:00Z');
    Notifier.notifyQuotaPaused(resetTime, 45, 'claude');

    expect(provider.sentMessages.length).toBe(5);
    expect(provider.sentMessages[4].text).toContain('[arleypadua/imagos] ⏳ *Quota Limit Reached*');
    expect(provider.sentMessages[4].text).toContain('• *Runner*: `claude`');

    // 6. Quota Resumed
    Notifier.notifyQuotaResumed('claude');

    expect(provider.sentMessages.length).toBe(6);
    expect(provider.sentMessages[5].text).toContain('[arleypadua/imagos] ▶️ *Quota Resumed*');
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
