import { EventEmitter } from 'node:events';
import { execa } from 'execa';
import pc from 'picocolors';
import type {
  TaskStartedNotificationPayload,
  TaskCompletedNotificationPayload,
  SpecCompletedNotificationPayload,
  NeedsInfoNotificationPayload,
  QuotaPausedNotificationPayload,
  QuotaResumedNotificationPayload,
} from '../remote/types.js';

export interface NotificationOptions {
  title: string;
  message: string;
  subtitle?: string;
  sound?: boolean;
}

export class Notifier {
  private static emitter = new EventEmitter();

  public static get events(): EventEmitter {
    return Notifier.emitter;
  }

  public static on(event: string, listener: (...args: any[]) => void): void {
    Notifier.emitter.on(event, listener);
  }

  public static off(event: string, listener: (...args: any[]) => void): void {
    Notifier.emitter.off(event, listener);
  }

  public static removeAllListeners(event?: string): void {
    Notifier.emitter.removeAllListeners(event);
  }

  public static async notifyDesktop(options: NotificationOptions): Promise<void> {
    try {
      const soundClause = options.sound !== false ? 'sound name "default"' : '';
      const subtitleClause = options.subtitle ? `subtitle "${options.subtitle.replace(/"/g, '\\"')}"` : '';
      const script = `display notification "${options.message.replace(/"/g, '\\"')}" with title "${options.title.replace(/"/g, '\\"')}" ${subtitleClause} ${soundClause}`;

      await execa('osascript', ['-e', script]);
    } catch {
      // Fallback silently if osascript is unavailable (e.g. non-macOS or CI)
    }
  }

  public static notifyTaskStarted(payload: TaskStartedNotificationPayload): void {
    const title = `Auto-Pilot: Task Started`;
    const action = payload.isContinuation ? 'resumed' : 'started';
    const message = `Issue #${payload.issueNumber} (${payload.issueTitle}) ${action} by ${payload.runnerName}`;
    this.notifyDesktop({ title, message });
    console.log(
      pc.cyan(
        `\n🤖 [Task ${payload.isContinuation ? 'Resumed' : 'Started'}] Issue #${payload.issueNumber}: ${payload.issueTitle} [${payload.runnerName}]`
      )
    );
    Notifier.emitter.emit('task_started', payload);
  }

  public static notifyTaskNeedsFeedback(
    issueNumber: number,
    issueTitle: string,
    question?: string,
    prUrl?: string,
    prNumber?: number
  ): void {
    const title = `Auto-Pilot: Feedback Needed`;
    const message = `Issue #${issueNumber} (${issueTitle}) is waiting for your reply.`;
    this.notifyDesktop({ title, message, subtitle: question?.slice(0, 50) });
    console.log(pc.yellow(`\n🔔 [Human Feedback Required] Issue #${issueNumber}: ${issueTitle}`));
    if (question) {
      console.log(pc.yellow(`   Question: ${question}`));
    }
    const payload: NeedsInfoNotificationPayload = {
      issueNumber,
      issueTitle,
      question,
      prUrl,
      prNumber,
    };
    Notifier.emitter.emit('needs_info', payload);
  }

  public static notifyNeedsFeedback(
    issueNumber: number,
    issueTitle: string,
    question?: string,
    prUrl?: string,
    prNumber?: number
  ): void {
    this.notifyTaskNeedsFeedback(issueNumber, issueTitle, question, prUrl, prNumber);
  }

  public static notifySpecComplete(specNumber: number, specTitle: string): void {
    const title = `Auto-Pilot: Spec #${specNumber} Complete`;
    const message = `All child tickets for Spec #${specNumber} are done!`;
    this.notifyDesktop({ title, message });
    console.log(pc.magenta(`\n🎉 [Spec Complete] Spec #${specNumber}: ${specTitle} — Waiting for developer review & closure.`));
    const payload: SpecCompletedNotificationPayload = { specNumber, specTitle };
    Notifier.emitter.emit('spec_completed', payload);
  }

  public static notifyQuotaPaused(resetAt: Date, waitMinutes: number, runnerName?: string): void {
    const title = `Auto-Pilot: Quota Paused`;
    const timeStr = resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const message = `5h quota reached. Pausing workers. Resumes at ${timeStr} (~${waitMinutes}m).`;
    this.notifyDesktop({ title, message });
    console.log(pc.red(`\n⏳ [Quota Limit] Pausing workers until ${timeStr} (~${waitMinutes} min)`));
    const payload: QuotaPausedNotificationPayload = { resetAt, waitMinutes, runnerName };
    Notifier.emitter.emit('quota_paused', payload);
  }

  public static notifyQuotaResumed(runnerName?: string): void {
    const payload: QuotaResumedNotificationPayload = { runnerName };
    Notifier.emitter.emit('quota_resumed', payload);
  }

  public static notifyTaskMerged(
    issueNumber: number,
    issueTitle: string,
    prUrl?: string,
    prNumber?: number,
    baseBranch?: string
  ): void {
    const title = `Auto-Pilot: Task Completed & Merged`;
    const message = `Issue #${issueNumber} merged into main!`;
    this.notifyDesktop({ title, message });
    console.log(pc.green(`\n🎉 [Completed & Merged] Issue #${issueNumber}: ${issueTitle} ${prUrl ? `(${prUrl})` : ''}`));
    const payload: TaskCompletedNotificationPayload = {
      issueNumber,
      issueTitle,
      prUrl,
      prNumber,
      baseBranch,
    };
    Notifier.emitter.emit('task_completed', payload);
  }
}

