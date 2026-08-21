import type {
  TaskStartedNotificationPayload,
  TaskCompletedNotificationPayload,
  SpecCompletedNotificationPayload,
  NeedsInfoNotificationPayload,
  QuotaPausedNotificationPayload,
  QuotaResumedNotificationPayload,
  StatusSummary,
  TasksSummary,
  SpecsSummary,
  SecurityStatusInfo,
  InteractiveAction,
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
  lines.push('', '💡 _Swipe to reply, or comment on GitHub and label `ready-for-agent`._');
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
  if (payload.affectedIssues && payload.affectedIssues.length > 0) {
    const issuesStr = payload.affectedIssues.map((n) => `#${n}`).join(', ');
    lines.push(`• *Suspended Tasks*: ${issuesStr}`);
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

/**
 * Formats daemon status summary for /status command.
 */
export function formatStatus(repository: string | undefined, summary: Partial<StatusSummary> & Record<string, any>): string {
  const repoTag = formatRepoTag(repository);
  const lines = [`${repoTag}⚡ *Imagos Daemon Status*`, ''];

  // 1. Health Status
  let healthText = '🟢 Running (Dispatching Active)';
  if (summary.quota?.isPaused || summary.daemonStatus === 'paused_quota' || summary.status === 'paused_quota') {
    healthText = '⏸️ Paused (5h Quota Limit)';
  } else if (summary.isDispatchingPaused || summary.isSessionStarted === false) {
    healthText = '⏸️ Paused (Dispatching Disabled)';
  } else if (summary.daemonStatus === 'idle' || summary.status === 'idle') {
    healthText = '⚪ Idle';
  }
  lines.push(`• *Health*: ${healthText}`);

  // 2. Active Worker Count & Max Concurrency
  const activeCount = summary.activeWorkerCount ?? summary.activeWorkers?.length ?? (summary.workers?.length || 0);
  const maxConcurrency = summary.maxConcurrency ?? 2;
  lines.push(`• *Active Workers*: ${activeCount} / ${maxConcurrency}`);

  // 3. Current Git Branches / Worktrees
  const activeWorkers = summary.activeWorkers || summary.workers || [];
  const activeWorktrees = summary.activeWorktrees || [];

  if (activeWorkers.length > 0) {
    lines.push(`• *Active Branches*:`);
    for (const w of activeWorkers) {
      const runnerStr = w.runnerName ? ` (${w.runnerName})` : '';
      lines.push(`  - #${w.issueNumber}${runnerStr}: \`${w.branchName || 'agent/issue-' + w.issueNumber}\``);
    }
  } else if (activeWorktrees.length > 0) {
    lines.push(`• *Active Branches*:`);
    for (const wt of activeWorktrees) {
      const issueStr = wt.issueNumber ? `#${wt.issueNumber}: ` : '';
      lines.push(`  - ${issueStr}\`${wt.branch}\``);
    }
  } else {
    lines.push(`• *Active Branches*: None`);
  }

  // 4. Target Specs
  const targetSpecs: number[] = summary.targetSpecs || [];
  if (targetSpecs.length > 0) {
    lines.push(`• *Target Specs*: ${targetSpecs.map((s) => `#${s}`).join(', ')}`);
  } else {
    lines.push(`• *Target Specs*: All / Unscoped (any unblocked task)`);
  }

  // 5. Quota Status
  if (summary.quota) {
    if (summary.quota.isPaused && summary.quota.resetAt) {
      const resetTime = new Date(summary.quota.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const runnerStr = summary.quota.pausedRunner ? ` [${summary.quota.pausedRunner}]` : '';
      lines.push(`• *Quota*: ⏳ Paused until ${resetTime}${runnerStr}`);
    } else {
      lines.push(`• *Quota*: ✅ Available`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats task list for /tasks command, returning formatted text and inline action buttons.
 */
export function formatTasks(
  repository: string | undefined,
  tasksData: TasksSummary
): { text: string; actions: InteractiveAction[][] } {
  const repoTag = formatRepoTag(repository);
  const lines = [`${repoTag}📋 *Task Execution Backlog*`];
  const actions: InteractiveAction[][] = [];

  let hasAnyTasks = false;

  // In-Progress Tasks
  if (tasksData.inProgress && tasksData.inProgress.length > 0) {
    hasAnyTasks = true;
    lines.push('', '▶️ *In-Progress Tasks*:');
    for (const t of tasksData.inProgress) {
      const runnerStr = t.runnerName ? ` | Runner: \`${t.runnerName}\`` : '';
      lines.push(`• *#${t.issueNumber}* - *${escapeMarkdown(t.title)}*`);
      lines.push(`  └ Branch: \`${t.branchName || 'agent/issue-' + t.issueNumber}\`${runnerStr}`);
      actions.push([
        {
          id: `t_pause_${t.issueNumber}`,
          label: `⏸️ Pause #${t.issueNumber}`,
          payload: `v1:t:pause:${t.issueNumber}`,
        },
      ]);
    }
  }

  // Paused Tasks
  if (tasksData.paused && tasksData.paused.length > 0) {
    hasAnyTasks = true;
    lines.push('', '⏸️ *Paused Tasks*:');
    for (const t of tasksData.paused) {
      const runnerStr = t.runnerName ? ` | Runner: \`${t.runnerName}\`` : '';
      lines.push(`• *#${t.issueNumber}* - *${escapeMarkdown(t.title)}*`);
      lines.push(`  └ Branch: \`${t.branchName || 'agent/issue-' + t.issueNumber}\`${runnerStr}`);
      actions.push([
        {
          id: `t_resume_${t.issueNumber}`,
          label: `▶️ Resume #${t.issueNumber}`,
          payload: `v1:t:resume:${t.issueNumber}`,
        },
      ]);
    }
  }

  // Queued Tasks
  if (tasksData.queued && tasksData.queued.length > 0) {
    hasAnyTasks = true;
    lines.push('', '⏳ *Queued Tasks*:');
    for (const t of tasksData.queued) {
      const runnerStr = t.runnerName ? ` (\`${t.runnerName}\`)` : '';
      lines.push(`• *#${t.issueNumber}* - ${escapeMarkdown(t.title)}${runnerStr}`);
    }
  }

  if (!hasAnyTasks) {
    lines.push('', 'No active, paused, or queued tasks.');
  }

  return { text: lines.join('\n'), actions };
}

/**
 * Formats parent specifications list for /specs command.
 */
export function formatSpecs(
  repository: string | undefined,
  specsData: SpecsSummary
): { text: string; actions: InteractiveAction[][] } {
  const repoTag = formatRepoTag(repository);
  const lines = [`${repoTag}🎯 *Parent Specifications*`, ''];

  const targetSpecs = specsData.targetSpecs || [];
  const scopeStr = targetSpecs.length > 0 ? targetSpecs.map((s) => `#${s}`).join(', ') : 'All / Unscoped';
  lines.push(`*Current Target Scope*: ${scopeStr}`);

  const actions: InteractiveAction[][] = [];

  if (specsData.specs && specsData.specs.length > 0) {
    lines.push('', '*Available Specifications*:');
    for (const s of specsData.specs) {
      const statusIcon = s.isComplete || s.state === 'CLOSED' ? '✅' : '🏗️';
      const progress = `(${s.completedTickets}/${s.totalTickets} tickets)`;
      lines.push(`• ${statusIcon} *#${s.number}* - ${escapeMarkdown(s.title)} ${progress}`);

      actions.push([
        {
          id: `s_set_${s.number}`,
          label: `🎯 Scope to #${s.number}`,
          payload: `v1:s:set:${s.number}`,
        },
      ]);
    }
  } else {
    lines.push('', 'No parent specifications found in backlog.');
  }

  // Add button to select all / unscoped
  actions.push([
    {
      id: 's_all',
      label: '🌐 All Specs (Unscoped)',
      payload: 'v1:s:all',
    },
  ]);

  lines.push('', '💡 *Tip*: Use `/specs <number>` (e.g. `/specs 22`) or `/specs all` to switch target scopes remotely.');

  return { text: lines.join('\n'), actions };
}

/**
 * Formats command reference and security status for /help command.
 */
export function formatHelp(repository: string | undefined, securityInfo: SecurityStatusInfo): string {
  const repoTag = formatRepoTag(repository);
  const lines = [
    `${repoTag}📖 *Imagos Remote Bot Help*`,
    '',
    '*Available Slash Commands*:',
    '• `/status` - View daemon health, active workers, git branches, and target specs',
    '• `/tasks` - View in-progress, paused, and queued tasks with pause/resume controls',
    '• `/pause [issue]` - Pause global task dispatching or pause a specific worker',
    '• `/resume [issue]` - Clear rate-limit pause and resume workers',
    '• `/specs [numbers|all]` - List and switch scoped parent specs',
    '• `/clean` - Clean inactive worktrees and temp branches',
    '• `/inspect <issue>` - Inspect active worker tool calls & diffs',
    '• `/logs <issue>` - View recent daemon logs',
    '• `/help` - Show command reference and usage',
    '',
    '🔒 *Security Status*:',
    `• *Authorization*: ${securityInfo.isAuthorized ? 'Authorized ✅' : 'Unauthorized ❌'}`,
    `• *Whitelist*: ${securityInfo.whitelistStatus}`,
    `• *Telegram User ID*: \`${securityInfo.userId}\``,
  ];

  return lines.join('\n');
}

/**
 * Formats response for /clean command.
 */
export function formatCleanResult(repository: string | undefined, count: number): string {
  const repoTag = formatRepoTag(repository);
  if (count === 0) {
    return `${repoTag}🧹 *Clean Complete*\n\nNo inactive worktrees or temporary branches found to clean.`;
  }
  return `${repoTag}🧹 *Clean Complete*\n\nCleaned up ${count} inactive worktree${count === 1 ? '' : 's'} and temporary branch${count === 1 ? '' : 'es'}.`;
}

/**
 * Formats response for /inspect command.
 */
export function formatInspect(repository: string | undefined, issueNumber: number, details: string): string {
  const repoTag = formatRepoTag(repository);
  return `${repoTag}🔍 *Inspection: Issue #${issueNumber}*\n\n${details}`;
}

/**
 * Formats usage help for /inspect command.
 */
export function formatInspectHelp(repository: string | undefined): string {
  const repoTag = formatRepoTag(repository);
  return `${repoTag}🔍 *Inspect Usage*\n\nUse \`/inspect <issueNumber>\` (e.g. \`/inspect 42\`) to inspect active worker tool calls and git diffs.`;
}

/**
 * Formats response for /logs command.
 */
export function formatLogs(repository: string | undefined, issueNumber: number, logs: string): string {
  const repoTag = formatRepoTag(repository);
  const truncated = logs.length > 3000 ? logs.slice(-3000) : logs;
  return `${repoTag}📜 *Logs: Issue #${issueNumber}*\n\n\`\`\`\n${truncated}\n\`\`\``;
}

/**
 * Formats usage help for /logs command.
 */
export function formatLogsHelp(repository: string | undefined): string {
  const repoTag = formatRepoTag(repository);
  return `${repoTag}📜 *Logs Usage*\n\nUse \`/logs <issueNumber>\` (e.g. \`/logs 42\`) to view recent execution logs for an issue.`;
}

/**
 * Formats notification when task dispatching is paused globally.
 */
export function formatDispatchPaused(repository: string | undefined): string {
  const repoTag = formatRepoTag(repository);
  return `${repoTag}⏸️ *Task Dispatching Paused*\n\nOrchestrator task dispatching is paused. No new tasks will be dispatched.\nActive workers will continue until their current turn completes.`;
}

/**
 * Formats notification when task dispatching is resumed globally.
 */
export function formatDispatchResumed(repository: string | undefined): string {
  const repoTag = formatRepoTag(repository);
  return `${repoTag}▶️ *Task Dispatching Resumed*\n\nOrchestrator task dispatching is active. Ready tasks will be dispatched up to concurrency limits.`;
}

/**
 * Formats notification when target specs scope is updated.
 */
export function formatSpecsUpdated(repository: string | undefined, targetSpecs: number[]): string {
  const repoTag = formatRepoTag(repository);
  if (targetSpecs.length > 0) {
    return `${repoTag}🎯 *Target Scope Updated*\n\nScoped to Spec(s): ${targetSpecs.map((s) => `#${s}`).join(', ')}`;
  }
  return `${repoTag}🎯 *Target Scope Updated*\n\nScoped to all unblocked tasks (all specs).`;
}

/**
 * Formats response for individual worker pause/resume action.
 */
export function formatTaskActionResponse(
  repository: string | undefined,
  action: 'pause' | 'resume',
  issueNumber: number,
  result: { success: boolean; message: string }
): string {
  const repoTag = formatRepoTag(repository);
  if (result.success) {
    const actionStr = action === 'pause' ? '⏸️ Paused' : '▶️ Resumed';
    return `${repoTag}${actionStr} worker for Issue #${issueNumber}.`;
  }
  return `${repoTag}⚠️ Failed to ${action} worker for Issue #${issueNumber}: ${result.message}`;
}

/**
 * Parses callback data for task actions (e.g. `v1:t:pause:24` or `v1:t:resume:24`).
 */
export function parseTaskActionPayload(
  payload: string
): { action: 'pause' | 'resume'; issueNumber: number } | null {
  if (!payload || typeof payload !== 'string' || !payload.startsWith('v1:t:')) {
    return null;
  }
  const parts = payload.split(':');
  if (parts.length >= 4) {
    const act = parts[2];
    const num = parseInt(parts[3], 10);
    if (!isNaN(num) && (act === 'pause' || act === 'p')) {
      return { action: 'pause', issueNumber: num };
    }
    if (!isNaN(num) && (act === 'resume' || act === 'r')) {
      return { action: 'resume', issueNumber: num };
    }
  }
  return null;
}

/**
 * Parses callback data for spec actions (e.g. `v1:s:set:22` or `v1:s:all`).
 */
export function parseSpecActionPayload(
  payload: string
): { action: 'set' | 'all'; specNumbers: number[] } | null {
  if (!payload || typeof payload !== 'string' || !payload.startsWith('v1:s:')) {
    return null;
  }
  const parts = payload.split(':');
  if (parts[2] === 'all') {
    return { action: 'all', specNumbers: [] };
  }
  if (parts[2] === 'set' && parts[3]) {
    const num = parseInt(parts[3], 10);
    if (!isNaN(num)) {
      return { action: 'set', specNumbers: [num] };
    }
  }
  return null;
}
