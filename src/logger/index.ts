import util from 'node:util';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
export type LogHandler = (message: string, level: LogLevel) => void;

/**
 * ActivityLogger provides centralized logging for the entire application.
 * It routes logs, warnings, and errors directly to the Activity Log (Dashboard/UI)
 * and can intercept console.* methods to prevent unhandled stdout/stderr writes
 * that corrupt terminal UI layouts (Ink/TUI).
 */
export class ActivityLogger {
  private static handlers: Set<LogHandler> = new Set();
  private static primaryHandler?: (message: string) => void;
  private static isIntercepting: boolean = false;
  private static originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  /**
   * Sets the primary log handler (typically Dashboard.log).
   */
  public static setLogHandler(handler?: (message: string) => void): void {
    ActivityLogger.primaryHandler = handler;
  }

  /**
   * Returns the current primary log handler.
   */
  public static getLogHandler(): ((message: string) => void) | undefined {
    return ActivityLogger.primaryHandler;
  }

  /**
   * Registers a log listener callback.
   * Returns an unregister function.
   */
  public static addHandler(handler: LogHandler): () => void {
    ActivityLogger.handlers.add(handler);
    return () => {
      ActivityLogger.handlers.delete(handler);
    };
  }

  /**
   * Removes a registered log listener.
   */
  public static removeHandler(handler: LogHandler): void {
    ActivityLogger.handlers.delete(handler);
  }

  /**
   * Removes all registered handlers and clears the primary handler.
   */
  public static removeAllHandlers(): void {
    ActivityLogger.handlers.clear();
    ActivityLogger.primaryHandler = undefined;
  }

  private static formatArgs(message: any, ...optionalParams: any[]): string {
    if (typeof message === 'string' && optionalParams.length === 0) {
      return message;
    }
    return util.format(message, ...optionalParams);
  }

  private static emit(level: LogLevel, formattedMessage: string): void {
    if (ActivityLogger.primaryHandler) {
      try {
        ActivityLogger.primaryHandler(formattedMessage);
      } catch {}
    }
    for (const handler of ActivityLogger.handlers) {
      try {
        handler(formattedMessage, level);
      } catch {}
    }
  }

  /**
   * Logs a general activity message to the activity log.
   */
  public static log(message: any, ...optionalParams: any[]): void {
    const formatted = ActivityLogger.formatArgs(message, ...optionalParams);
    ActivityLogger.emit('log', formatted);
  }

  /**
   * Logs an informational activity message.
   */
  public static info(message: any, ...optionalParams: any[]): void {
    const formatted = ActivityLogger.formatArgs(message, ...optionalParams);
    ActivityLogger.emit('info', formatted);
  }

  /**
   * Logs a warning to the activity log.
   */
  public static warn(message: any, ...optionalParams: any[]): void {
    let formatted = ActivityLogger.formatArgs(message, ...optionalParams);
    if (!formatted.includes('⚠️')) {
      formatted = `⚠️ ${formatted}`;
    }
    ActivityLogger.emit('warn', formatted);
  }

  /**
   * Logs an error to the activity log.
   */
  public static error(message: any, ...optionalParams: any[]): void {
    let formatted: string;
    if (message instanceof Error) {
      const extra = optionalParams.length > 0 ? ' ' + ActivityLogger.formatArgs('', ...optionalParams).trim() : '';
      formatted = `${message.message}${extra}`;
    } else {
      formatted = ActivityLogger.formatArgs(message, ...optionalParams);
    }
    if (!formatted.includes('❌')) {
      formatted = `❌ ${formatted}`;
    }
    ActivityLogger.emit('error', formatted);
  }

  /**
   * Logs a debug message to the activity log.
   */
  public static debug(message: any, ...optionalParams: any[]): void {
    const formatted = ActivityLogger.formatArgs(message, ...optionalParams);
    ActivityLogger.emit('debug', formatted);
  }

  /**
   * Intercepts console.log, console.info, console.warn, console.error, and console.debug
   * so all console calls are captured and routed into the Activity Log instead of
   * printing raw characters to stdout/stderr which breaks terminal UI renderers (Ink).
   */
  public static interceptConsole(): void {
    if (ActivityLogger.isIntercepting) return;
    ActivityLogger.isIntercepting = true;

    console.log = (...args: any[]) => {
      ActivityLogger.log(args[0], ...args.slice(1));
    };
    console.info = (...args: any[]) => {
      ActivityLogger.info(args[0], ...args.slice(1));
    };
    console.warn = (...args: any[]) => {
      ActivityLogger.warn(args[0], ...args.slice(1));
    };
    console.error = (...args: any[]) => {
      ActivityLogger.error(args[0], ...args.slice(1));
    };
    console.debug = (...args: any[]) => {
      ActivityLogger.debug(args[0], ...args.slice(1));
    };
  }

  /**
   * Restores the original native console methods.
   */
  public static restoreConsole(): void {
    if (!ActivityLogger.isIntercepting) return;
    ActivityLogger.isIntercepting = false;

    console.log = ActivityLogger.originalConsole.log;
    console.info = ActivityLogger.originalConsole.info;
    console.warn = ActivityLogger.originalConsole.warn;
    console.error = ActivityLogger.originalConsole.error;
    console.debug = ActivityLogger.originalConsole.debug;
  }

  /**
   * Checks if console methods are currently intercepted.
   */
  public static isConsoleIntercepted(): boolean {
    return ActivityLogger.isIntercepting;
  }
}

export const logger = ActivityLogger;
