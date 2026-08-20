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
 * Parses multiple-choice options from a question string.
 * Supports:
 * - Numbered lists: 1. Option, 2. Option or 1) Option, 2) Option or (1) Option or [1] Option
 * - Lettered lists: A. Option, B. Option or A) Option, B) Option or (A) Option or [A] Option
 * - Explicit choice prefixes: Option 1: ..., Choice A: ...
 * - Bullet lists: - Option, * Option, • Option
 */
export function parseQuestionChoices(questionText?: string): string[] {
  if (!questionText || typeof questionText !== 'string') {
    return [];
  }

  const lines = questionText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return [];
  }

  // 1. Try numbered pattern (with optional leading bullet): "- 1. ...", "1. ...", "1) ...", "(1) ...", "[1] ..."
  const numberedPattern = /^(?:[-*•]\s+)?(?:(?:\d+[\.\)])|(?:\(\d+\))|(?:\[\d+\]))\s+(.+)$/;
  const numberedChoices: string[] = [];
  for (const line of lines) {
    const match = line.match(numberedPattern);
    if (match && match[1]) {
      numberedChoices.push(match[1].trim());
    }
  }
  if (numberedChoices.length >= 2) {
    return numberedChoices;
  }

  // 2. Try lettered pattern (with optional leading bullet): "- A. ...", "A. ...", "A) ...", "(A) ...", "[A] ...", "a. ...", "a) ..."
  const letteredPattern = /^(?:[-*•]\s+)?(?:(?:[a-zA-Z][\.\)])|(?:\([a-zA-Z]\))|(?:\[[a-zA-Z]\]))\s+(.+)$/;
  const letteredChoices: string[] = [];
  for (const line of lines) {
    const match = line.match(letteredPattern);
    if (match && match[1]) {
      letteredChoices.push(match[1].trim());
    }
  }
  if (letteredChoices.length >= 2) {
    return letteredChoices;
  }

  // 3. Try explicit Option/Choice prefix: "Option 1: ...", "Choice A: ..."
  const optionPrefixPattern = /^(?:[-*•]\s+)?(?:Option|Choice)\s+(?:\d+|[a-zA-Z]):?\s*(.+)$/i;
  const optionChoices: string[] = [];
  for (const line of lines) {
    const match = line.match(optionPrefixPattern);
    if (match && match[1]) {
      optionChoices.push(match[1].trim());
    }
  }
  if (optionChoices.length >= 2) {
    return optionChoices;
  }

  // 4. Try simple bullet pattern: "- ...", "* ...", "• ..."
  const bulletPattern = /^(?:[-*•])\s+(.+)$/;
  const bulletChoices: string[] = [];
  for (const line of lines) {
    const match = line.match(bulletPattern);
    if (match && match[1]) {
      bulletChoices.push(match[1].trim());
    }
  }
  if (bulletChoices.length >= 2) {
    return bulletChoices;
  }

  return [];
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
  } else if (payload.issueUrl) {
    lines.push('', `• *Issue*: [Issue #${payload.issueNumber}](${payload.issueUrl})`);
  }
  return lines.join('\n');
}

/**
 * Formats a needs-info message that has been answered by the developer.
 */
export function formatNeedsInfoAnswered(
  repository: string | undefined,
  payload: NeedsInfoNotificationPayload,
  answer: string,
  mode: 'button' | 'text' = 'button'
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
  } else if (payload.issueUrl) {
    lines.push('', `• *Issue*: [Issue #${payload.issueNumber}](${payload.issueUrl})`);
  }
  const modeText = mode === 'text' ? 'via text' : 'via button';
  lines.push('', `✅ *Answered* (${modeText}): ${escapeMarkdown(answer)}`);
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

/**
 * Formats an inline quota resumption message edited by developer action.
 */
export function formatQuotaResumedByDeveloper(
  repository: string | undefined,
  options?: {
    originalText?: string;
    timestamp?: Date;
    runnerName?: string;
  }
): string {
  const time = options?.timestamp ?? new Date();
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const resumeNotice = `▶️ Resumed by developer at ${timeStr}`;

  if (options?.originalText) {
    if (options.originalText.includes('Resumed by developer at')) {
      return options.originalText;
    }
    return `${options.originalText}\n\n${resumeNotice}`;
  }

  const repoTag = formatRepoTag(repository);
  return `${repoTag}${resumeNotice}`;
}

/**
 * Builds compact callback data for resuming a paused runner.
 * Format: `v1:q:res:<runner>` (e.g. `v1:q:res:claude`, `v1:q:res:agy`, `v1:q:res:`)
 */
export function buildQuotaResumeCallbackData(runner?: string): string {
  const normalized = runner ? runner.toLowerCase().trim() : '';
  return `v1:q:res:${normalized}`;
}

/**
 * Parses a quota callback query payload.
 * Supports: `v1:q:res:<runner>` or `v1:q:res`
 */
export function parseQuotaActionPayload(
  payload: string
): { action: 'resume'; runner?: string } | null {
  if (!payload || typeof payload !== 'string' || !payload.startsWith('v1:q:')) {
    return null;
  }
  const parts = payload.split(':');
  if (parts[2] === 'res') {
    const runner = parts.slice(3).join(':').trim();
    if (!runner || runner.toLowerCase() === 'all') {
      return { action: 'resume', runner: undefined };
    }
    return { action: 'resume', runner };
  }
  return null;
}
