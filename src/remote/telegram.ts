import { Bot, InlineKeyboard, type Context, type NextFunction } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import type {
  RemoteControlProvider,
  RemoteMessageOptions,
  TelegramRemoteProviderOptions,
} from './types.js';
import { TelegramRateLimiter } from './rate_limiter.js';

export class TelegramRemoteProvider implements RemoteControlProvider {
  public readonly name = 'telegram';
  private bot: Bot;
  private allowedUserIds?: number[];
  private defaultChatId?: number | string;
  private rateLimiter: TelegramRateLimiter;
  private isRunning: boolean = false;
  private actionHandlers: Map<string, (action: string, payload: string, userId: number) => Promise<void>> = new Map();
  private textReplyHandlers: Array<(replyToMessageId: number, text: string, userId: number) => Promise<void>> = [];
  private commandHandlers: Map<string, (args: string[], userId: number) => Promise<void>> = new Map();

  constructor(options: TelegramRemoteProviderOptions) {
    this.allowedUserIds = options.allowedUserIds;
    this.defaultChatId = options.defaultChatId;
    this.rateLimiter = options.rateLimiter ?? new TelegramRateLimiter();

    if (options.bot) {
      this.bot = options.bot;
    } else {
      if (!options.botToken) {
        throw new Error('Telegram bot token is required');
      }
      this.bot = new Bot(options.botToken);
      this.bot.api.config.use(
        autoRetry(options.autoRetryOptions ?? { maxRetryAttempts: 3, maxDelaySeconds: 60 })
      );
    }

    this.setupMiddleware();
  }

  public getBot(): Bot {
    return this.bot;
  }

  public getRateLimiter(): TelegramRateLimiter {
    return this.rateLimiter;
  }

  public getDefaultChatId(): number | string | undefined {
    return this.defaultChatId;
  }

  public getAllowedUserIds(): number[] | undefined {
    return this.allowedUserIds;
  }

  private setupMiddleware(): void {
    // 1. Authorization Whitelist Middleware
    this.bot.use(async (ctx: Context, next: NextFunction) => {
      if (!this.allowedUserIds || this.allowedUserIds.length === 0) {
        return next();
      }

      const userId = ctx.from?.id;
      if (userId !== undefined && this.allowedUserIds.includes(userId)) {
        return next();
      }

      // Unauthorized sender
      const isPrivate = ctx.chat?.type === 'private';
      if (isPrivate && ctx.chat?.id) {
        try {
          await this.rateLimiter.enqueue(ctx.chat.id, () =>
            this.bot.api.sendMessage(
              ctx.chat!.id,
              `🔒 *Unauthorized*: Your Telegram User ID (\`${userId ?? 'unknown'}\`) is not whitelisted to control this Imagos instance.`,
              { parse_mode: 'Markdown' }
            )
          );
        } catch {
          // Ignore failure to reply to unauthorized user
        }
      }
      // Drop unauthorized message (do not call next())
    });

    // 2. Callback query handling for interactive actions
    this.bot.on('callback_query:data', async (ctx: Context, next: NextFunction) => {
      const data = ctx.callbackQuery?.data;
      const userId = ctx.from?.id;
      if (!data || userId === undefined) {
        return next();
      }

      let handled = false;
      for (const [prefix, handler] of this.actionHandlers.entries()) {
        if (data.startsWith(prefix)) {
          handled = true;
          try {
            await ctx.answerCallbackQuery();
          } catch {}
          try {
            await handler(prefix, data, userId);
          } catch (err: any) {
            console.error(`Error handling action "${data}":`, err);
          }
          break;
        }
      }

      if (!handled) {
        return next();
      }
    });

    // 3. Text reply handling
    this.bot.on('message:text', async (ctx: Context, next: NextFunction) => {
      const replyTo = ctx.message?.reply_to_message;
      const text = ctx.message?.text;
      const userId = ctx.from?.id;

      if (replyTo && text && userId !== undefined && this.textReplyHandlers.length > 0) {
        for (const handler of this.textReplyHandlers) {
          try {
            await handler(replyTo.message_id, text, userId);
          } catch (err: any) {
            console.error('Error handling text reply:', err);
          }
        }
      }

      return next();
    });
  }


  public onAction(
    actionPrefix: string,
    handler: (action: string, payload: string, userId: number) => Promise<void>
  ): void {
    this.actionHandlers.set(actionPrefix, handler);
  }

  public onTextReply(
    handler: (replyToMessageId: number, text: string, userId: number) => Promise<void>
  ): void {
    this.textReplyHandlers.push(handler);
  }

  public onCommand(
    command: string,
    handler: (args: string[], userId: number) => Promise<void>
  ): void {
    const cleanCommand = command.replace(/^\//, '');
    this.commandHandlers.set(cleanCommand, handler);
    this.bot.command(cleanCommand, async (ctx: Context) => {
      const userId = ctx.from?.id;
      if (userId === undefined) return;
      const match = ctx.match;
      const args = typeof match === 'string' && match.trim() ? match.trim().split(/\s+/) : [];
      await handler(args, userId);
    });
  }

  public async sendMessage(
    text: string,
    options?: RemoteMessageOptions
  ): Promise<{ messageId: number }> {
    const targetChatId = options?.chatId ?? this.defaultChatId;
    if (targetChatId === undefined) {
      throw new Error('No chatId specified and no defaultChatId configured');
    }

    const parseMode = options?.parseMode ?? 'Markdown';
    const extra: Record<string, any> = {
      parse_mode: parseMode,
    };

    if (options?.replyToMessageId) {
      extra.reply_to_message_id = options.replyToMessageId;
    }

    if (options?.actions && options.actions.length > 0) {
      const keyboard = new InlineKeyboard();
      for (let r = 0; r < options.actions.length; r++) {
        const row = options.actions[r];
        for (const btn of row) {
          if (btn.url) {
            keyboard.url(btn.label, btn.url);
          } else {
            keyboard.text(btn.label, btn.payload);
          }
        }
        if (r < options.actions.length - 1) {
          keyboard.row();
        }
      }
      extra.reply_markup = keyboard;
    }

    const res = await this.rateLimiter.enqueue(targetChatId, () =>
      this.bot.api.sendMessage(targetChatId, text, extra)
    );

    return { messageId: res.message_id };
  }

  public async editMessage(
    messageId: number,
    text: string,
    options?: RemoteMessageOptions
  ): Promise<void> {
    const targetChatId = options?.chatId ?? this.defaultChatId;
    if (targetChatId === undefined) {
      throw new Error('No chatId specified and no defaultChatId configured');
    }

    const parseMode = options?.parseMode ?? 'Markdown';
    const extra: Record<string, any> = {
      parse_mode: parseMode,
    };

    if (options?.actions && options.actions.length > 0) {
      const keyboard = new InlineKeyboard();
      for (let r = 0; r < options.actions.length; r++) {
        const row = options.actions[r];
        for (const btn of row) {
          if (btn.url) {
            keyboard.url(btn.label, btn.url);
          } else {
            keyboard.text(btn.label, btn.payload);
          }
        }
        if (r < options.actions.length - 1) {
          keyboard.row();
        }
      }
      extra.reply_markup = keyboard;
    }

    await this.rateLimiter.enqueue(targetChatId, () =>
      this.bot.api.editMessageText(targetChatId, messageId, text, extra)
    );
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      this.bot
        .start({
          drop_pending_updates: true,
        })
        .catch((err) => {
          if (this.isRunning) {
            console.error('Telegram bot polling error:', err);
          }
        });
    } catch (err: any) {
      this.isRunning = false;
      throw err;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    try {
      await this.bot.stop();
    } catch {
      // Ignore stop errors if bot was not polling
    }

    this.rateLimiter.destroy();
  }
}
