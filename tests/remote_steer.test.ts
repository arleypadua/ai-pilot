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

class MockRemoteProvider implements RemoteControlProvider {
  public readonly name = 'mock';
  public isStarted = false;
  public sentMessages: Array<{ text: string; options?: RemoteMessageOptions }> = [];
  public editedMessages: Array<{ messageId: number; text: string; options?: RemoteMessageOptions }> = [];
  public actionHandlers: Map<
    string,
    (action: string, payload: string, userId: number, context?: ActionContext) => Promise<void>
  > = new Map();
  public commandHandlers: Map<
    string,
    (args: string[], userId: number, context?: ActionContext) => Promise<void>
  > = new Map();
  public textReplyHandlers: Array<(replyToMessageId: number, text: string, userId: number) => Promise<void>> = [];
  public allowedUserIds?: number[] = [123456];

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

  public onCommand(
    command: string,
    handler: (args: string[], userId: number, context?: ActionContext) => Promise<void>
  ): void {
    this.commandHandlers.set(command, handler);
  }

  public onTextReply(
    handler: (replyToMessageId: number, text: string, userId: number) => Promise<void>
  ): void {
    this.textReplyHandlers.push(handler);
  }

  public getAllowedUserIds(): number[] | undefined {
    return this.allowedUserIds;
  }

  public async triggerCommand(
    command: string,
    args: string[],
    userId: number = 123456,
    context?: ActionContext
  ): Promise<void> {
    const handler = this.commandHandlers.get(command);
    if (handler) {
      await handler(args, userId, context);
    }
  }

  public async triggerTextReply(
    replyToMessageId: number,
    text: string,
    userId: number = 123456
  ): Promise<void> {
    for (const handler of this.textReplyHandlers) {
      await handler(replyToMessageId, text, userId);
    }
  }
}

describe('Remote Control Steering & Live Tail Reporting', () => {
  let provider: MockRemoteProvider;
  let manager: RemoteControlManager;
  let mockController: RemoteActionController & {
    injectedPrompts: Array<{ issueNumber: number; prompt: string }>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    Notifier.removeAllListeners();
    AgentEventBus.getInstance().clearHistory();

    provider = new MockRemoteProvider();
    mockController = {
      injectedPrompts: [],
      replyToNeedsInfo: vi.fn().mockResolvedValue(undefined),
      resumeQuota: vi.fn(),
      pauseTask: vi.fn().mockResolvedValue({ success: true, message: 'Paused' }),
      resumeTask: vi.fn().mockResolvedValue({ success: true, message: 'Resumed' }),
      setTargetSpecs: vi.fn(),
      getStatusSummary: vi.fn().mockReturnValue({}),
      getTasksSummary: vi.fn().mockReturnValue({
        inProgress: [
          {
            issueNumber: 42,
            title: 'Refactor mutex logic',
            branchName: 'agent/issue-42',
            status: 'running',
          },
        ],
        paused: [],
        queued: [],
      }),
      injectPrompt: vi.fn().mockImplementation(async (issueNumber: number, prompt: string) => {
        mockController.injectedPrompts.push({ issueNumber, prompt });
        return {
          success: true,
          message: `Injected prompt for active task #${issueNumber}. Waiting for tool call to finish.`,
        };
      }),
      getLiveTailReport: vi.fn().mockImplementation(async (issueNumber: number) => {
        return {
          issueNumber,
          status: 'running',
          branchName: 'agent/issue-42',
          runnerName: 'claude',
          events: [
            {
              timestamp: '15:42:01',
              summary: '🔧 EditFile: src/sync/mutex.ts',
              type: 'tool_start',
            },
            {
              timestamp: '15:42:05',
              summary: '🧪 Bash: pnpm test tests/mutex.test.ts',
              type: 'tool_end',
            },
          ],
          diffStat: 'src/sync/mutex.ts | 12 +++++++++---',
        };
      }),
    };

    manager = new RemoteControlManager({
      provider,
      repository: 'owner/repo',
      defaultChatId: 9999,
      actionController: mockController,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Notifier.removeAllListeners();
    vi.restoreAllMocks();
  });

  it('handles /steer <issueNumber> <prompt>, sends immediate feedback and delayed live tail report', async () => {
    await provider.triggerCommand('steer', ['42', 'use', 'the', 'new', 'Mutex', 'class']);

    expect(mockController.injectPrompt).toHaveBeenCalledWith(42, 'use the new Mutex class');
    expect(provider.sentMessages.length).toBe(1);

    const feedbackMsg = provider.sentMessages[0].text;
    expect(feedbackMsg).toContain('Steering Applied');
    expect(feedbackMsg).toContain('#42');
    expect(feedbackMsg).toContain('use the new Mutex class');
    expect(feedbackMsg).toContain('Observing session live tail');

    // Fast-forward 8 seconds to trigger the delayed live tail report
    await vi.advanceTimersByTimeAsync(8000);

    expect(mockController.getLiveTailReport).toHaveBeenCalledWith(42, expect.any(Number));
    expect(provider.sentMessages.length).toBe(2);

    const reportMsg = provider.sentMessages[1].text;
    expect(reportMsg).toContain('Steering Live Tail Report');
    expect(reportMsg).toContain('#42');
    expect(reportMsg).toContain('EditFile: src/sync/mutex.ts');
    expect(reportMsg).toContain('Bash: pnpm test tests/mutex.test.ts');
    expect(reportMsg).toContain('src/sync/mutex.ts | 12 +++++++++---');
  });

  it('automatically resolves single active worker when issue number is omitted in /steer', async () => {
    await provider.triggerCommand('steer', ['focus', 'on', 'unit', 'tests']);

    expect(mockController.injectPrompt).toHaveBeenCalledWith(42, 'focus on unit tests');
    expect(provider.sentMessages.length).toBe(1);
    expect(provider.sentMessages[0].text).toContain('Steering Applied');
    expect(provider.sentMessages[0].text).toContain('#42');
  });

  it('warns when multiple active workers are running and issue number is not specified', async () => {
    mockController.getTasksSummary = vi.fn().mockReturnValue({
      inProgress: [
        { issueNumber: 10, title: 'Task 10', status: 'running' },
        { issueNumber: 20, title: 'Task 20', status: 'running' },
      ],
      paused: [],
      queued: [],
    });

    await provider.triggerCommand('steer', ['do', 'this', 'first']);

    expect(mockController.injectPrompt).not.toHaveBeenCalled();
    expect(provider.sentMessages.length).toBe(1);
    expect(provider.sentMessages[0].text).toContain('Currently Active Sessions (tap to copy)');
    expect(provider.sentMessages[0].text).toContain('#10');
    expect(provider.sentMessages[0].text).toContain('/steer 10 <your instructions>');
    expect(provider.sentMessages[0].text).toContain('#20');
    expect(provider.sentMessages[0].text).toContain('/steer 20 <your instructions>');
  });

  it('warns when no active workers are running and issue number is not specified', async () => {
    mockController.getTasksSummary = vi.fn().mockReturnValue({
      inProgress: [],
      paused: [],
      queued: [],
    });

    await provider.triggerCommand('steer', ['some', 'instruction']);

    expect(mockController.injectPrompt).not.toHaveBeenCalled();
    expect(provider.sentMessages.length).toBe(1);
    expect(provider.sentMessages[0].text).toContain('No workers are currently running');
    expect(provider.sentMessages[0].text).toContain('/steer <issueNumber>');
  });

  it('supports /prompt alias identically to /steer', async () => {
    await provider.triggerCommand('prompt', ['42', 'please', 'check', 'types']);

    expect(mockController.injectPrompt).toHaveBeenCalledWith(42, 'please check types');
    expect(provider.sentMessages.length).toBe(1);
    expect(provider.sentMessages[0].text).toContain('Steering Applied');
  });

  it('steers active task when developer replies directly to task_started notification message', async () => {
    const startedMsg = await manager.sendTaskStarted({
      issueNumber: 42,
      issueTitle: 'Refactor mutex logic',
      runnerName: 'claude',
      branchName: 'agent/issue-42',
    });

    expect(startedMsg).toBeDefined();
    expect(startedMsg?.messageId).toBe(1);

    // Reply directly to that task_started notification message
    await provider.triggerTextReply(1, 'Make sure to add timeout handling');

    expect(mockController.injectPrompt).toHaveBeenCalledWith(42, 'Make sure to add timeout handling');
    expect(provider.sentMessages.length).toBe(2);
    expect(provider.sentMessages[1].text).toContain('Steering Applied');
    expect(provider.sentMessages[1].text).toContain('#42');
  });
});
