import { execa } from 'execa';
import pc from 'picocolors';

export interface NotificationOptions {
  title: string;
  message: string;
  subtitle?: string;
  sound?: boolean;
}

export class Notifier {
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

  public static notifyTaskNeedsFeedback(issueNumber: number, issueTitle: string, question?: string): void {
    const title = `Auto-Pilot: Feedback Needed`;
    const message = `Issue #${issueNumber} (${issueTitle}) is waiting for your reply.`;
    this.notifyDesktop({ title, message, subtitle: question?.slice(0, 50) });
    console.log(pc.yellow(`\n🔔 [Human Feedback Required] Issue #${issueNumber}: ${issueTitle}`));
    if (question) {
      console.log(pc.yellow(`   Question: ${question}`));
    }
  }

  public static notifyQuotaPaused(resetAt: Date, waitMinutes: number): void {
    const title = `Auto-Pilot: Quota Paused`;
    const timeStr = resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const message = `5h quota reached. Pausing workers. Resumes at ${timeStr} (~${waitMinutes}m).`;
    this.notifyDesktop({ title, message });
    console.log(pc.red(`\n⏳ [Quota Limit] Pausing workers until ${timeStr} (~${waitMinutes} min)`));
  }

  public static notifyTaskMerged(issueNumber: number, issueTitle: string, prUrl?: string): void {
    const title = `Auto-Pilot: Task Completed & Merged`;
    const message = `Issue #${issueNumber} merged into main!`;
    this.notifyDesktop({ title, message });
    console.log(pc.green(`\n🎉 [Completed & Merged] Issue #${issueNumber}: ${issueTitle} ${prUrl ? `(${prUrl})` : ''}`));
  }
}
