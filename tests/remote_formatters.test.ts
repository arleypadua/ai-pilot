import { describe, it, expect } from 'vitest';
import {
  escapeMarkdown,
  formatRepoTag,
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
  formatStatus,
  formatTasks,
  formatSpecs,
  formatHelp,
  formatDispatchPaused,
  formatDispatchResumed,
  formatSpecsUpdated,
  formatTaskActionResponse,
  parseTaskActionPayload,
  parseSpecActionPayload,
  formatBrowse,
  formatBrowseSpecDetail,
  buildBrowseRootCallbackData,
  buildBrowseSpecCallbackData,
  buildBrowseToggleCallbackData,
  buildBrowseEnqueueAllCallbackData,
  parseBrowseActionPayload,
} from '../src/remote/formatters.js';

describe('Remote Message Formatters', () => {
  describe('escapeMarkdown', () => {
    it('escapes Markdown special characters (*, _, `, [, ])', () => {
      const input = 'Fix *bug* with _feature_ and `code` [link]';
      const escaped = escapeMarkdown(input);
      expect(escaped).toBe('Fix \\*bug\\* with \\_feature\\_ and \\`code\\` \\[link\\]');
    });

    it('handles empty string or nullish value', () => {
      expect(escapeMarkdown('')).toBe('');
      expect(escapeMarkdown(undefined as any)).toBe('');
    });
  });

  describe('formatRepoTag', () => {
    it('formats repository tag with brackets', () => {
      expect(formatRepoTag('arleypadua/imagos')).toBe('[arleypadua/imagos] ');
    });

    it('returns empty string if repository is undefined', () => {
      expect(formatRepoTag(undefined)).toBe('');
    });
  });

  describe('formatTaskStarted', () => {
    it('formats fresh task start notification with repo tag', () => {
      const msg = formatTaskStarted('owner/repo', {
        issueNumber: 24,
        issueTitle: 'feat: add telegram remote control',
        runnerName: 'agy',
        branchName: 'agent/issue-24',
        sessionId: 'session-123',
        isContinuation: false,
      });

      expect(msg).toContain('[owner/repo] 🤖 *Task Started*: #24 - *feat: add telegram remote control*');
      expect(msg).toContain('• *Runner*: `agy`');
      expect(msg).toContain('• *Branch*: `agent/issue-24`');
      expect(msg).toContain('• *Session*: `session-123`');
    });

    it('formats resumed task notification', () => {
      const msg = formatTaskStarted('owner/repo', {
        issueNumber: 24,
        issueTitle: 'feat: add telegram remote control',
        runnerName: 'claude',
        branchName: 'agent/issue-24',
        isContinuation: true,
      });

      expect(msg).toContain('[owner/repo] 🔄 *Task Resumed*: #24');
    });
  });

  describe('formatTaskCompleted', () => {
    it('formats task completed & merged with PR link and base branch', () => {
      const msg = formatTaskCompleted('owner/repo', {
        issueNumber: 24,
        issueTitle: 'feat: outbound notifications',
        prNumber: 30,
        prUrl: 'https://github.com/owner/repo/pull/30',
        baseBranch: 'main',
      });

      expect(msg).toContain('[owner/repo] 🎉 *Task Completed & Merged*: #24 - *feat: outbound notifications*');
      expect(msg).toContain('• *Pull Request*: [PR #30](https://github.com/owner/repo/pull/30)');
      expect(msg).toContain('• *Base Branch*: `main`');
    });
  });

  describe('formatSpecCompleted', () => {
    it('formats spec complete notification', () => {
      const msg = formatSpecCompleted('owner/repo', {
        specNumber: 22,
        specTitle: 'Spec: Remote Control via Telegram',
      });

      expect(msg).toContain('[owner/repo] 🏆 *Spec Complete*: #22 - *Spec: Remote Control via Telegram*');
      expect(msg).toContain('All child tickets for Spec #22 have been implemented and merged!');
    });
  });

  describe('formatNeedsInfo', () => {
    it('formats feedback needed notification with question and PR link', () => {
      const msg = formatNeedsInfo('owner/repo', {
        issueNumber: 24,
        issueTitle: 'feat: notifications',
        question: 'Should we enable auto-retry?',
        prNumber: 30,
        prUrl: 'https://github.com/owner/repo/pull/30',
      });

      expect(msg).toContain('[owner/repo] ❓ *Feedback Needed*: #24 - *feat: notifications*');
      expect(msg).toContain('*Question*:\nShould we enable auto-retry?');
      expect(msg).toContain('• *Pull Request*: [PR #30](https://github.com/owner/repo/pull/30)');
      expect(msg).toContain('Swipe to reply, or comment on GitHub and label `ready-for-agent`');
    });
  });

  describe('parseQuestionChoices', () => {
    it('parses numbered choices (1. / 2.)', () => {
      const q = `Which auth method should we use?
1. JWT Authentication
2. Session Cookies
3. OAuth 2.0`;
      const choices = parseQuestionChoices(q);
      expect(choices).toEqual(['JWT Authentication', 'Session Cookies', 'OAuth 2.0']);
    });

    it('parses numbered choices with parentheses or brackets (1) / [1])', () => {
      const q1 = `Select database:\n(1) SQLite\n(2) PostgreSQL`;
      expect(parseQuestionChoices(q1)).toEqual(['SQLite', 'PostgreSQL']);

      const q2 = `Select engine:\n[1] Docker\n[2] Podman`;
      expect(parseQuestionChoices(q2)).toEqual(['Docker', 'Podman']);
    });

    it('parses lettered choices (A. / B. / a) / b))', () => {
      const q1 = `Choose option:\nA. Enable cache\nB. Disable cache`;
      expect(parseQuestionChoices(q1)).toEqual(['Enable cache', 'Disable cache']);

      const q2 = `Choose option:\na) Fast mode\nb) Safe mode`;
      expect(parseQuestionChoices(q2)).toEqual(['Fast mode', 'Safe mode']);
    });

    it('parses explicit Option / Choice prefix', () => {
      const q = `Options:\nOption 1: Use Redis\nOption 2: Use Memory`;
      expect(parseQuestionChoices(q)).toEqual(['Use Redis', 'Use Memory']);
    });

    it('parses bullet choices (- / * / •)', () => {
      const q = `Should we proceed?\n- Yes, merge now\n- No, wait for tests`;
      expect(parseQuestionChoices(q)).toEqual(['Yes, merge now', 'No, wait for tests']);
    });

    it('returns empty array when no choices are present', () => {
      expect(parseQuestionChoices('What is the API key?')).toEqual([]);
      expect(parseQuestionChoices('')).toEqual([]);
      expect(parseQuestionChoices(undefined)).toEqual([]);
    });
  });

  describe('formatNeedsInfoAnswered', () => {
    it('formats answered feedback notification for button click', () => {
      const msg = formatNeedsInfoAnswered(
        'owner/repo',
        {
          issueNumber: 26,
          issueTitle: 'feat: needs-info replies',
          question: 'Which runner?',
        },
        'agy',
        'button'
      );

      expect(msg).toContain('[owner/repo] ❓ *Feedback Needed*: #26');
      expect(msg).toContain('*Question*:\nWhich runner?');
      expect(msg).toContain('✅ *Answered* (via button): agy');
    });

    it('formats answered feedback notification for text reply', () => {
      const msg = formatNeedsInfoAnswered(
        'owner/repo',
        {
          issueNumber: 26,
          issueTitle: 'feat: needs-info replies',
          question: 'Which database?',
        },
        'Use PostgreSQL 16',
        'text'
      );

      expect(msg).toContain('✅ *Answered* (via text): Use PostgreSQL 16');
    });
  });

  describe('formatQuotaPaused and formatQuotaResumed', () => {
    it('formats quota paused notification', () => {
      const resetAt = new Date('2026-08-20T18:30:00Z');
      const msg = formatQuotaPaused('owner/repo', {
        resetAt,
        waitMinutes: 45,
        runnerName: 'claude',
      });

      expect(msg).toContain('[owner/repo] ⏳ *Quota Limit Reached*');
      expect(msg).toContain('~45m');
      expect(msg).toContain('• *Runner*: `claude`');
    });

    it('formats quota paused notification with suspended tasks list', () => {
      const resetAt = new Date('2026-08-20T18:30:00Z');
      const msg = formatQuotaPaused('owner/repo', {
        resetAt,
        waitMinutes: 45,
        runnerName: 'claude',
        affectedIssues: [201, 202],
      });

      expect(msg).toContain('[owner/repo] ⏳ *Quota Limit Reached*');
      expect(msg).toContain('• *Runner*: `claude`');
      expect(msg).toContain('• *Suspended Tasks*: #201, #202');
    });

    it('formats quota resumed notification', () => {
      const msg = formatQuotaResumed('owner/repo', {
        runnerName: 'claude',
      });

      expect(msg).toContain('[owner/repo] ▶️ *Quota Resumed*');
      expect(msg).toContain('Workers resumed for runner `claude`');
    });
  });

  describe('formatQuotaResumedByDeveloper', () => {
    it('appends developer resumption notice to original text with timestamp', () => {
      const original = '[owner/repo] ⏳ *Quota Limit Reached*\n\n5h rolling quota reached.';
      const timestamp = new Date('2026-08-20T19:45:00Z');
      const msg = formatQuotaResumedByDeveloper('owner/repo', {
        originalText: original,
        timestamp,
        runnerName: 'claude',
      });

      expect(msg).toContain(original);
      expect(msg).toContain('▶️ Resumed by developer at');
    });

    it('formats developer resumption notice without original text', () => {
      const timestamp = new Date('2026-08-20T19:45:00Z');
      const msg = formatQuotaResumedByDeveloper('owner/repo', {
        timestamp,
      });

      expect(msg).toContain('[owner/repo] ▶️ Resumed by developer at');
    });

    it('does not duplicate developer resumption notice if already present in original text', () => {
      const original = '[owner/repo] ⏳ *Quota Limit Reached*\n\n▶️ Resumed by developer at 07:45 PM';
      const msg = formatQuotaResumedByDeveloper('owner/repo', {
        originalText: original,
      });

      expect(msg).toBe(original);
    });
  });

  describe('buildQuotaResumeCallbackData', () => {
    it('builds callback data with specific runner', () => {
      expect(buildQuotaResumeCallbackData('claude')).toBe('v1:q:res:claude');
      expect(buildQuotaResumeCallbackData('AGY')).toBe('v1:q:res:agy');
    });

    it('builds callback data without runner (all runners)', () => {
      expect(buildQuotaResumeCallbackData()).toBe('v1:q:res:');
      expect(buildQuotaResumeCallbackData('')).toBe('v1:q:res:');
    });
  });

  describe('parseQuotaActionPayload', () => {
    it('parses valid callback data for a specific runner', () => {
      expect(parseQuotaActionPayload('v1:q:res:claude')).toEqual({
        action: 'resume',
        runner: 'claude',
      });
      expect(parseQuotaActionPayload('v1:q:res:agy')).toEqual({
        action: 'resume',
        runner: 'agy',
      });
    });

    it('parses callback data for all runners / empty runner', () => {
      expect(parseQuotaActionPayload('v1:q:res:')).toEqual({
        action: 'resume',
        runner: undefined,
      });
      expect(parseQuotaActionPayload('v1:q:res:all')).toEqual({
        action: 'resume',
        runner: undefined,
      });
      expect(parseQuotaActionPayload('v1:q:res')).toEqual({
        action: 'resume',
        runner: undefined,
      });
    });

    it('returns null for invalid or non-quota callback payloads', () => {
      expect(parseQuotaActionPayload('v1:inf:42:1')).toBeNull();
      expect(parseQuotaActionPayload('v1:q:unknown:claude')).toBeNull();
      expect(parseQuotaActionPayload('invalid_data')).toBeNull();
      expect(parseQuotaActionPayload('')).toBeNull();
      expect(parseQuotaActionPayload(null as any)).toBeNull();
    });
  });

  describe('formatStatus', () => {
    it('formats running status with active workers, git branches, and target specs', () => {
      const msg = formatStatus('owner/repo', {
        daemonStatus: 'running',
        activeWorkerCount: 2,
        maxConcurrency: 3,
        activeWorkers: [
          { issueNumber: 24, title: 'feat: notifications', branchName: 'agent/issue-24', status: 'running', runnerName: 'agy' },
          { issueNumber: 25, title: 'feat: quota alert', branchName: 'agent/issue-25', status: 'running', runnerName: 'claude' },
        ],
        targetSpecs: [22],
        quota: { isPaused: false },
      });

      expect(msg).toContain('[owner/repo] ⚡ *Imagos Daemon Status*');
      expect(msg).toContain('• *Health*: 🟢 Running (Dispatching Active)');
      expect(msg).toContain('• *Active Workers*: 2 / 3');
      expect(msg).toContain('• *Active Branches*:');
      expect(msg).toContain('  - #24 (agy): `agent/issue-24`');
      expect(msg).toContain('  - #25 (claude): `agent/issue-25`');
      expect(msg).toContain('• *Target Specs*: #22');
      expect(msg).toContain('• *Quota*: ✅ Available');
    });

    it('formats paused quota and paused dispatching status', () => {
      const pausedQuotaMsg = formatStatus('owner/repo', {
        daemonStatus: 'paused_quota',
        quota: { isPaused: true, resetAt: new Date('2026-08-20T20:00:00Z'), pausedRunner: 'claude' },
      });
      expect(pausedQuotaMsg).toContain('• *Health*: ⏸️ Paused (5h Quota Limit)');
      expect(pausedQuotaMsg).toContain('• *Quota*: ⏳ Paused until');

      const pausedDispatchMsg = formatStatus('owner/repo', {
        daemonStatus: 'idle',
        isDispatchingPaused: true,
      });
      expect(pausedDispatchMsg).toContain('• *Health*: ⏸️ Paused (Dispatching Disabled)');

      const idleMsg = formatStatus('owner/repo', {
        daemonStatus: 'idle',
      });
      expect(idleMsg).toContain('• *Health*: ⚪ Idle');
      expect(idleMsg).toContain('• *Active Branches*: None');
      expect(idleMsg).toContain('• *Target Specs*: All / Unscoped');
    });
  });

  describe('formatTasks', () => {
    it('formats in-progress, paused, and queued tasks with inline buttons', () => {
      const { text, actions } = formatTasks('owner/repo', {
        inProgress: [
          { issueNumber: 24, title: 'feat: notifications', branchName: 'agent/issue-24', runnerName: 'agy', status: 'running' },
        ],
        paused: [
          { issueNumber: 25, title: 'feat: quota alert', branchName: 'agent/issue-25', runnerName: 'claude', status: 'paused_quota' },
        ],
        queued: [
          { issueNumber: 26, title: 'feat: needs-info', runnerName: 'agy', status: 'ready' },
        ],
      });

      expect(text).toContain('[owner/repo] 📋 *Task Execution Backlog*');
      expect(text).toContain('▶️ *In-Progress Tasks*:');
      expect(text).toContain('• *#24* - *feat: notifications*');
      expect(text).toContain('⏸️ *Paused Tasks*:');
      expect(text).toContain('• *#25* - *feat: quota alert*');
      expect(text).toContain('⏳ *Queued Tasks*:');
      expect(text).toContain('• *#26* - feat: needs-info');

      // Actions: 1 pause button for #24, 1 resume button for #25
      expect(actions.length).toBe(2);
      expect(actions[0][0].label).toBe('⏸️ Pause #24');
      expect(actions[0][0].payload).toBe('v1:t:pause:24');
      expect(actions[1][0].label).toBe('▶️ Resume #25');
      expect(actions[1][0].payload).toBe('v1:t:resume:25');
    });

    it('formats empty task list', () => {
      const { text, actions } = formatTasks('owner/repo', {
        inProgress: [],
        paused: [],
        queued: [],
      });

      expect(text).toContain('No active, paused, or queued tasks.');
      expect(actions.length).toBe(0);
    });
  });

  describe('formatSpecs', () => {
    it('formats parent specs with progress and action buttons', () => {
      const { text, actions } = formatSpecs('owner/repo', {
        targetSpecs: [22],
        specs: [
          { number: 22, title: 'Epic: Remote Control', isComplete: false, totalTickets: 5, completedTickets: 3, state: 'OPEN' },
          { number: 10, title: 'Epic: Core Pipeline', isComplete: true, totalTickets: 4, completedTickets: 4, state: 'CLOSED' },
        ],
      });

      expect(text).toContain('[owner/repo] 🎯 *Parent Specifications*');
      expect(text).toContain('*Current Target Scope*: #22');
      expect(text).toContain('• 🏗️ *#22* - Epic: Remote Control (3/5 tickets)');
      expect(text).toContain('• ✅ *#10* - Epic: Core Pipeline (4/4 tickets)');

      // Actions: 1 button for #22, 1 button for #10, 1 button for All
      expect(actions.length).toBe(3);
      expect(actions[0][0].label).toBe('🎯 Scope to #22');
      expect(actions[0][0].payload).toBe('v1:s:set:22');
      expect(actions[1][0].label).toBe('🎯 Scope to #10');
      expect(actions[1][0].payload).toBe('v1:s:set:10');
      expect(actions[2][0].label).toBe('🌐 All Specs (Unscoped)');
      expect(actions[2][0].payload).toBe('v1:s:all');
    });
  });

  describe('formatHelp', () => {
    it('formats available slash commands and security whitelist status', () => {
      const msg = formatHelp('owner/repo', {
        userId: 123456,
        isAuthorized: true,
        whitelistStatus: 'Enabled (2 allowed users)',
        allowedUserCount: 2,
      });

      expect(msg).toContain('[owner/repo] 📖 *Imagos Remote Bot Help*');
      expect(msg).toContain('• `/status`');
      expect(msg).toContain('• `/tasks`');
      expect(msg).toContain('• `/pause [issue]`');
      expect(msg).toContain('• `/resume [issue]`');
      expect(msg).toContain('• `/specs [numbers|all]`');
      expect(msg).toContain('• `/help`');
      expect(msg).toContain('🔒 *Security Status*:');
      expect(msg).toContain('• *Authorization*: Authorized ✅');
      expect(msg).toContain('• *Whitelist*: Enabled (2 allowed users)');
      expect(msg).toContain('• *Telegram User ID*: `123456`');
    });
  });

  describe('formatDispatchPaused & formatDispatchResumed & formatSpecsUpdated & formatTaskActionResponse', () => {
    it('formats dispatching state notifications', () => {
      expect(formatDispatchPaused('owner/repo')).toContain('⏸️ *Task Dispatching Paused*');
      expect(formatDispatchResumed('owner/repo')).toContain('▶️ *Task Dispatching Resumed*');
    });

    it('formats target specs updated notification', () => {
      expect(formatSpecsUpdated('owner/repo', [22, 25])).toContain('Scoped to Spec(s): #22, #25');
      expect(formatSpecsUpdated('owner/repo', [])).toContain('Scoped to all unblocked tasks (all specs).');
    });

    it('formats worker pause/resume action response', () => {
      expect(formatTaskActionResponse('owner/repo', 'pause', 24, { success: true, message: '' })).toContain('⏸️ Paused worker for Issue #24');
      expect(formatTaskActionResponse('owner/repo', 'resume', 24, { success: true, message: '' })).toContain('▶️ Resumed worker for Issue #24');
      expect(formatTaskActionResponse('owner/repo', 'pause', 24, { success: false, message: 'No runner' })).toContain('⚠️ Failed to pause worker for Issue #24: No runner');
    });
  });

  describe('parseTaskActionPayload & parseSpecActionPayload', () => {
    it('parses task action callback payloads', () => {
      expect(parseTaskActionPayload('v1:t:pause:24')).toEqual({ action: 'pause', issueNumber: 24 });
      expect(parseTaskActionPayload('v1:t:p:24')).toEqual({ action: 'pause', issueNumber: 24 });
      expect(parseTaskActionPayload('v1:t:resume:24')).toEqual({ action: 'resume', issueNumber: 24 });
      expect(parseTaskActionPayload('v1:t:r:24')).toEqual({ action: 'resume', issueNumber: 24 });
      expect(parseTaskActionPayload('v1:t:invalid:24')).toBeNull();
      expect(parseTaskActionPayload('v1:other')).toBeNull();
    });

    it('parses spec action callback payloads', () => {
      expect(parseSpecActionPayload('v1:s:set:22')).toEqual({ action: 'set', specNumbers: [22] });
      expect(parseSpecActionPayload('v1:s:all')).toEqual({ action: 'all', specNumbers: [] });
      expect(parseSpecActionPayload('v1:s:invalid')).toBeNull();
      expect(parseSpecActionPayload('v1:other')).toBeNull();
    });
  });

  describe('formatBrowse & formatBrowseSpecDetail & parseBrowseActionPayload', () => {
    it('parses and builds browse action callback payloads', () => {
      expect(buildBrowseRootCallbackData(true)).toBe('v1:b:r:1');
      expect(buildBrowseRootCallbackData(false)).toBe('v1:b:r:0');
      expect(buildBrowseSpecCallbackData(22, true)).toBe('v1:b:s:22:1');
      expect(buildBrowseSpecCallbackData(22, false)).toBe('v1:b:s:22:0');
      expect(buildBrowseToggleCallbackData(true)).toBe('v1:b:t:1');
      expect(buildBrowseToggleCallbackData(false)).toBe('v1:b:t:0');
      expect(buildBrowseEnqueueAllCallbackData(22)).toBe('v1:b:ea:22');

      expect(parseBrowseActionPayload('v1:b:r:1')).toEqual({ type: 'root', showOnlyOpen: true });
      expect(parseBrowseActionPayload('v1:b:r:0')).toEqual({ type: 'root', showOnlyOpen: false });
      expect(parseBrowseActionPayload('v1:b:s:22:1')).toEqual({ type: 'spec', specNumber: 22, showOnlyOpen: true });
      expect(parseBrowseActionPayload('v1:b:s:22:0')).toEqual({ type: 'spec', specNumber: 22, showOnlyOpen: false });
      expect(parseBrowseActionPayload('v1:b:t:0')).toEqual({ type: 'toggle', showOnlyOpen: false });
      expect(parseBrowseActionPayload('v1:b:t:1')).toEqual({ type: 'toggle', showOnlyOpen: true });
      expect(parseBrowseActionPayload('v1:b:ea:22')).toEqual({ type: 'enqueueAll', specNumber: 22 });
      expect(parseBrowseActionPayload('v1:b:invalid')).toBeNull();
      expect(parseBrowseActionPayload('other')).toBeNull();
    });

    it('formats empty tree message when no specs or standalone issues exist', () => {
      const { text, actions } = formatBrowse('owner/repo', {
        specs: [],
        standaloneIssues: [],
        totalOpenSpecs: 0,
        totalOpenIssues: 0,
        readyIssueNumbers: [],
      });
      expect(text).toContain('[owner/repo]');
      expect(text).toContain('No open issues or specifications found in repository.');
      expect(actions).toHaveLength(1);
      expect(actions[0][0].label).toContain('Open GitHub Backlog');
    });

    it('formats root overview with spec buttons, filter toggle, standalone enqueue, and GitHub backlog button', () => {
      const { text, actions } = formatBrowse(
        'owner/repo',
        {
          specs: [
            {
              number: 10,
              title: 'User Auth Spec',
              isComplete: false,
              totalTickets: 2,
              completedTickets: 1,
              status: 'pending',
              children: [
                {
                  number: 11,
                  title: 'JWT Auth',
                  status: 'ready',
                  state: 'OPEN',
                  isClosed: false,
                },
                {
                  number: 12,
                  title: 'Login Controller',
                  status: 'completed',
                  state: 'CLOSED',
                  isClosed: true,
                },
              ],
            },
          ],
          standaloneIssues: [
            {
              number: 20,
              title: 'Fix DB reconnection',
              status: 'ready',
              state: 'OPEN',
            },
          ],
          totalOpenSpecs: 1,
          totalOpenIssues: 2,
          readyIssueNumbers: [11, 20],
        },
        { showOnlyOpen: false }
      );

      expect(text).toContain('🌳 *Issue Tree Browser*');
      expect(text).toContain('📁 *Specifications* (1):');
      expect(text).toContain('*#10* - *User Auth Spec* _(1/2 complete)_');
      expect(text).toContain('📄 *Standalone Issues* (1):');
      expect(text).toContain('• 🟢 *#20* - Fix DB reconnection');

      // Actions: Spec drill-down row, Filter toggle row, Standalone enqueue row, GitHub backlog row
      expect(actions.some((row) => row.some((b) => b.label.includes('#10') && b.payload === 'v1:b:s:10:0'))).toBe(true);
      expect(actions.some((row) => row.some((b) => b.label.includes('Filter: Open Only') && b.payload === 'v1:b:t:0'))).toBe(true);
      expect(actions.some((row) => row.some((b) => b.label.includes('#20') && b.payload.startsWith('v1:enq:20')))).toBe(true);
      expect(actions.some((row) => row.some((b) => b.label.includes('GitHub Backlog')))).toBe(true);
    });

    it('formats spec detail view with child task list, enqueue buttons, and back button', () => {
      const spec = {
        number: 10,
        title: 'User Auth Spec',
        isComplete: false,
        totalTickets: 3,
        completedTickets: 1,
        status: 'pending' as const,
        blockers: [5],
        worker: {
          issueNumber: 10,
          title: 'User Auth Spec',
          branchName: 'agent/issue-10',
          status: 'running' as const,
        },
        children: [
          {
            number: 11,
            title: 'JWT Auth',
            status: 'ready' as const,
            state: 'OPEN',
            isClosed: false,
          },
          {
            number: 12,
            title: 'OAuth Controller',
            status: 'ready' as const,
            state: 'OPEN',
            isClosed: false,
          },
          {
            number: 13,
            title: 'Login Controller',
            status: 'completed' as const,
            state: 'CLOSED',
            isClosed: true,
          },
        ],
      };

      const { text, actions } = formatBrowseSpecDetail('owner/repo', spec, { showOnlyOpen: false });

      expect(text).toContain('⚡ *Spec #10: User Auth Spec*');
      expect(text).toContain('Progress: 1 of 3 child tickets complete');
      expect(text).toContain('• *Blockers*: #5');
      expect(text).toContain('• *Active Worktree*: `agent/issue-10` (running)');
      expect(text).toContain('├── 🟢 *#11* - JWT Auth');
      expect(text).toContain('├── 🟢 *#12* - OAuth Controller');
      expect(text).toContain('└── ✔️ *#13* - Login Controller _(closed)_');

      // Check actions: individual enqueue buttons, bulk enqueue button, back button, GitHub link
      expect(actions.some((row) => row.some((b) => b.label.includes('#11')))).toBe(true);
      expect(actions.some((row) => row.some((b) => b.label.includes('#12')))).toBe(true);
      expect(actions.some((row) => row.some((b) => b.label.includes('Enqueue All 2 Open Tasks') && b.payload === 'v1:b:ea:10'))).toBe(true);
      expect(actions.some((row) => row.some((b) => b.label.includes('Back to Tree') && b.payload === 'v1:b:r:0'))).toBe(true);
      expect(actions.some((row) => row.some((b) => b.label.includes('View on GitHub') && b.url?.includes('/issues/10')))).toBe(true);
    });
  });
});
