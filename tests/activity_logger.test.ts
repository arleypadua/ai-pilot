import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ActivityLogger, logger } from '../src/logger/index.js';
import { Dashboard } from '../src/ui/dashboard.js';
import { DEFAULT_CONFIG } from '../src/config/schema.js';

describe('ActivityLogger and Console Interception', () => {
  beforeEach(() => {
    ActivityLogger.restoreConsole();
    ActivityLogger.removeAllHandlers();
  });

  afterEach(() => {
    ActivityLogger.restoreConsole();
    ActivityLogger.removeAllHandlers();
  });

  describe('Handler management & basic logging', () => {
    it('routes log, info, warn, error, and debug to primaryHandler', () => {
      const logs: string[] = [];
      ActivityLogger.setLogHandler((msg) => logs.push(msg));

      ActivityLogger.log('Standard log message');
      ActivityLogger.info('Informational message');
      ActivityLogger.warn('Warning: something is unusual');
      ActivityLogger.error('Something failed badly');
      ActivityLogger.debug('Debugging details');

      expect(logs.length).toBe(5);
      expect(logs[0]).toBe('Standard log message');
      expect(logs[1]).toBe('Informational message');
      expect(logs[2]).toBe('⚠️ Warning: something is unusual');
      expect(logs[3]).toBe('❌ Something failed badly');
      expect(logs[4]).toBe('Debugging details');
    });

    it('routes logs to multiple registered handlers via addHandler', () => {
      const handlerLogs1: Array<{ msg: string; level: string }> = [];
      const handlerLogs2: Array<{ msg: string; level: string }> = [];

      const unsubscribe1 = ActivityLogger.addHandler((msg, level) => {
        handlerLogs1.push({ msg, level });
      });
      const unsubscribe2 = ActivityLogger.addHandler((msg, level) => {
        handlerLogs2.push({ msg, level });
      });

      logger.warn('Disk quota threshold reached');
      logger.error(new Error('Connection timed out'));

      expect(handlerLogs1.length).toBe(2);
      expect(handlerLogs1[0]).toEqual({ msg: '⚠️ Disk quota threshold reached', level: 'warn' });
      expect(handlerLogs1[1]).toEqual({ msg: '❌ Connection timed out', level: 'error' });

      expect(handlerLogs2.length).toBe(2);

      // Unsubscribe one handler
      unsubscribe1();
      logger.info('Runner started');

      expect(handlerLogs1.length).toBe(2);
      expect(handlerLogs2.length).toBe(3);
    });

    it('formats multiple arguments and objects with util.format', () => {
      const logs: string[] = [];
      ActivityLogger.setLogHandler((msg) => logs.push(msg));

      ActivityLogger.log('Processing issue #%d for repo %s', 42, 'owner/repo');
      ActivityLogger.log('Metadata payload:', { status: 'ok', count: 5 });

      expect(logs[0]).toBe('Processing issue #42 for repo owner/repo');
      expect(logs[1]).toContain("status: 'ok'");
      expect(logs[1]).toContain('count: 5');
    });

    it('formats Error objects correctly in error()', () => {
      const logs: string[] = [];
      ActivityLogger.setLogHandler((msg) => logs.push(msg));

      ActivityLogger.error(new Error('Fatal database crash'));
      expect(logs[0]).toBe('❌ Fatal database crash');
    });

    it('preserves existing emoji indicators in warn and error', () => {
      const logs: string[] = [];
      ActivityLogger.setLogHandler((msg) => logs.push(msg));

      ActivityLogger.warn('⚠️ Custom warning indicator');
      ActivityLogger.error('❌ Custom error indicator');

      expect(logs[0]).toBe('⚠️ Custom warning indicator');
      expect(logs[1]).toBe('❌ Custom error indicator');
    });
  });

  describe('Console Interception (prevents UI disruption)', () => {
    it('intercepts console.log, console.warn, and console.error and redirects them to Activity Log', () => {
      const capturedLogs: string[] = [];
      ActivityLogger.setLogHandler((msg) => capturedLogs.push(msg));

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      ActivityLogger.interceptConsole();
      expect(ActivityLogger.isConsoleIntercepted()).toBe(true);

      console.log('Intercepted stdout log message');
      console.warn('Intercepted stdout warning');
      console.error('Intercepted stderr error message');

      // Native stdout/stderr MUST NOT be written to directly while intercepted
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();

      // Everything must go to the activity log
      expect(capturedLogs.length).toBe(3);
      expect(capturedLogs[0]).toBe('Intercepted stdout log message');
      expect(capturedLogs[1]).toBe('⚠️ Intercepted stdout warning');
      expect(capturedLogs[2]).toBe('❌ Intercepted stderr error message');

      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it('restores native console methods on restoreConsole()', () => {
      const originalLog = console.log;
      ActivityLogger.interceptConsole();
      expect(console.log).not.toBe(originalLog);

      ActivityLogger.restoreConsole();
      expect(ActivityLogger.isConsoleIntercepted()).toBe(false);
      expect(console.log).toBe(originalLog);
    });
  });

  describe('Dashboard Integration', () => {
    it('stores ActivityLogger messages inside Dashboard logs and retrieves them', () => {
      const dashboard = new Dashboard({
        ...DEFAULT_CONFIG,
        repository: 'owner/repo',
      });

      ActivityLogger.setLogHandler((msg) => dashboard.log(msg));

      ActivityLogger.info('Agent runner initialized');
      ActivityLogger.warn('Worktree branch already exists');
      ActivityLogger.error('Failed to parse issue DAG');

      const logs = dashboard.getLogs();
      expect(logs.length).toBe(3);
      expect(logs[0]).toMatch(/^\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?\] Agent runner initialized/);
      expect(logs[1]).toMatch(/^\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?\] ⚠️ Worktree branch already exists/);
      expect(logs[2]).toMatch(/^\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?\] ❌ Failed to parse issue DAG/);
    });

    it('avoids duplicate timestamps when message already has timestamp prefix', () => {
      const dashboard = new Dashboard({
        ...DEFAULT_CONFIG,
        repository: 'owner/repo',
      });

      dashboard.log('[10:15:30] Pre-timestamped log');
      const logs = dashboard.getLogs();
      expect(logs[0]).toBe('[10:15:30] Pre-timestamped log');
    });
  });
});
