import type {
  TaskStartedNotificationPayload,
  TaskCompletedNotificationPayload,
  SpecCompletedNotificationPayload,
  NeedsInfoNotificationPayload,
  QuotaPausedNotificationPayload,
  QuotaResumedNotificationPayload,
} from './types.js';

/**
 * Escapes characters that have special meaning in Telegram Markdown (v1).
 * Specifically escapes `*`, `_`, `` ` ``, and `[`.
 */
export function escapeMarkdown(text: string): string {
  if (!text) return '';
  return text.replace(/([*_`\[\]])/g, '\\$1');
}

/**
 * Formats the repository prefix tag (e.g. `[owner/repo] `).
 */
export function formatRepoTag(repository?: string): string {
  return repository ? `[${repository}] ` : '';
}

/**
 * Formats a task started / resumed notification.
 */
export function formatTaskStarted(
  repository: string | undefined,
  payload: TaskStartedNotificationPayload
): string {
  const repoTag = formatRepoTag(repository);
  const action = payload.isContinuation ? '🔄 *Task Resumed*' : '🤖 *Task Started*';
  const lines = [
    `${repoTag}${action}: #${payload.issueNumber} - *${escapeMarkdown(payload.issueTitle)}*`,
    '',
    `• *Runner*: \`${payload.runnerName}\``,
    `• *Branch*: \`${payload.branchName}\``,
  ];
  if (payload.sessionId) {
    lines.push(`• *Session*: \`${payload.sessionId}\``);
  }
  return lines.join('\n');
}

/**
 * Formats a task completed & merged notification.
 */
export function formatTaskCompleted(
  repository: string | undefined,
  payload: TaskCompletedNotificationPayload
): string {
  const repoTag = formatRepoTag(repository);
  const lines = [
    `${repoTag}🎉 *Task Completed & Merged*: #${payload.issueNumber} - *${escapeMarkdown(payload.issueTitle)}*`,
  ];
  if (payload.prUrl) {
    const prLabel = payload.prNumber ? `PR #${payload.prNumber}` : `PR for #${payload.issueNumber}`;
    lines.push('', `• *Pull Request*: [${prLabel}](${payload.prUrl})`);
  } else if (payload.prNumber) {
    lines.push('', `• *Pull Request*: PR #${payload.prNumber}`);
  }
  if (payload.baseBranch) {
    lines.push(`• *Base Branch*: \`${payload.baseBranch}\``);
  }
  return lines.join('\n');
}

/**
 * Formats a spec completed notification.
 */
export function formatSpecCompleted(
  repository: string | undefined,
  payload: SpecCompletedNotificationPayload
): string {
  const repoTag = formatRepoTag(repository);
  return [
    `${repoTag}🏆 *Spec Complete*: #${payload.specNumber} - *${escapeMarkdown(payload.specTitle)}*`,
    '',
    `All child tickets for Spec #${payload.specNumber} have been implemented and merged!`,
    `Waiting for developer review & closure.`,
  ].join('\n');
}

/**
 * Formats a feedback needed / needs-info notification.
 */
export function formatNeedsInfo(
  repository: string | undefined,
  payload: NeedsInfoNotificationPayload
): string {
  const repoTag = formatRepoTag(repository);
  const lines = [
    `${repoTag}❓ *Feedback Needed*: #${payload.issueNumber} - *${escapeMarkdown(payload.issueTitle)}*`,
  ];
  if (payload.question) {
    lines.push('', `*Question*:`, `${escapeMarkdown(payload.question)}`);
  }
  if (payload.prUrl) {
    const prLabel = payload.prNumber ? `PR #${payload.prNumber}` : `PR for #${payload.issueNumber}`;
    lines.push('', `• *Pull Request*: [${prLabel}](${payload.prUrl})`);
  }
  return lines.join('\n');
}

/**
 * Formats a quota paused notification.
 */
export function formatQuotaPaused(
  repository: string | undefined,
  payload: QuotaPausedNotificationPayload
): string {
  const repoTag = formatRepoTag(repository);
  const timeStr = payload.resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const lines = [
    `${repoTag}⏳ *Quota Limit Reached*`,
    '',
    `5h rolling quota reached. Pausing workers.`,
    `• *Resumes at*: ${timeStr} (~${payload.waitMinutes}m)`,
  ];
  if (payload.runnerName) {
    lines.push(`• *Runner*: \`${payload.runnerName}\``);
  }
  return lines.join('\n');
}

/**
 * Formats a quota resumed notification.
 */
export function formatQuotaResumed(
  repository: string | undefined,
  payload: QuotaResumedNotificationPayload
): string {
  const repoTag = formatRepoTag(repository);
  const runnerStr = payload.runnerName ? ` for runner \`${payload.runnerName}\`` : '';
  return `${repoTag}▶️ *Quota Resumed*\n\nWorkers resumed${runnerStr}.`;
}
