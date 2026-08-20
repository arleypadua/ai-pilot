import { describe, it, expect } from 'vitest';
import {
  escapeMarkdown,
  formatRepoTag,
  formatTaskStarted,
  formatTaskCompleted,
  formatSpecCompleted,
  formatNeedsInfo,
  formatQuotaPaused,
  formatQuotaResumed,
  formatQuotaResumedByDeveloper,
  buildQuotaResumeCallbackData,
  parseQuotaActionPayload,
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
});
