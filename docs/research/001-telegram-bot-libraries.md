# Research Report 001: Telegram Bot Libraries & Long-Polling Integration for TypeScript ESM

- **Issue Reference**: #17 (Part of Epic #16: Remote Control via Extensible Bot Interface)
- **Status**: Completed
- **Date**: 2026-08-20
- **Author**: AI Research Agent (Antigravity)
- **Target Environment**: Node.js 20+ / 22+, TypeScript 5.7+, Native ESM (`"type": "module"`), `tsx` execution

---

## 1. Executive Summary & Recommendation

### Recommendation: **`grammY` (v1.45+)**

For the `imagos` daemon, **`grammY`** is the definitive recommendation.

1. **Native ESM & Modern TypeScript Architecture**: Built from the ground up in TypeScript with first-class ESM conditional exports (`./out/mod.js` / `./out/web.mjs`), `grammY` integrates seamlessly with `imagos`'s `"type": "module"` and `tsx` execution stack without compilation workarounds or `@types` desynchronization.
2. **Type-Safe Inline Keyboards & Context Narrowing**: Provides fluent `InlineKeyboard` builders and compile-time type narrowing via filter queries (`bot.on("callback_query:data")` and `bot.callbackQuery(...)`), eliminating boilerplate assertions (`!`, `as string`) when handling interactive button clicks.
3. **Resilient Long-Polling & Outbound Zero-Port Model**: Built-in long-polling engine handles HTTP `getUpdates` cycles with configurable timeouts and update filters. Paired with `@grammyjs/auto-retry`, it automatically manages Telegram rate limits (`429 Too Many Requests` with dynamic `retry_after` backoff) and upstream server errors (`502 Bad Gateway`, `504 Gateway Timeout`) without crashing daemon threads.
4. **Clean Embedding & Lifecycle in Daemons**: Simple `bot.start()` and `bot.stop()` lifecycle hooks that run concurrently on the Node.js event loop without spawning separate OS processes, allowing clean integration with `AgentEventBus`, `Notifier`, and `SIGINT`/`SIGTERM` handlers.
5. **Minimal Footprint**: Low dependency count (`@grammyjs/types`, `debug`, `node-fetch`, `abort-controller`) with zero native C/C++ bindings or external binary dependencies.

---

## 2. Evaluation & Comparison Matrix

| Criteria | `grammY` (v1.45+) | `telegraf` (v4.16+) | `node-telegram-bot-api` (v2.0 / legacy) | Minimal Native `fetch` (Custom) |
| :--- | :--- | :--- | :--- | :--- |
| **ESM Compatibility** | **Native** (Dual CJS/ESM, conditional export maps) | **Supported** (Dual exports, legacy internal structure) | **Partial/Transitional** (v2.0 added ESM, v0.66 CJS-only) | **Native** (Zero modules or pure `@grammyjs/types`) |
| **TypeScript Typing Fidelity** | **Superior** (Compile-time context narrowing, typed filter queries, fluent builders) | **Good** (Requires explicit generic parameters like `Telegraf<MyContext>`) | **Weak** (Historically loose types, manual payload parsing) | **Manual** (Requires writing or importing schema types) |
| **Inline Keyboard DX** | **High** (`new InlineKeyboard().text(...).row()`) | **Moderate** (`Markup.inlineKeyboard([[Markup.button.callback(...)]])`) | **Low** (Raw JSON object construction) | **Manual** (Raw JSON construction) |
| **Dependency Footprint** | **Minimal** (4 dependencies, ~1.3 MB unpacked) | **Moderate** (8 dependencies, ~690 KB unpacked) | **Low** (0–5 depending on version) | **Zero Runtime Dependencies** (0 B runtime) |
| **Long-Polling Reliability** | **High** (Configurable `timeout`, `limit`, `allowed_updates`, `bot.catch`) | **High** (Configurable via `bot.launch`) | **Moderate** (Historical memory leak / EFATAL issues) | **Manual** (Must build backoff, retry, and abort logic) |
| **429/5xx Auto-Recovery** | **Automated** (via `@grammyjs/auto-retry` plugin) | **Manual** (Requires custom middleware / wrapper) | **Manual** (Requires manual exponential backoff) | **Manual** (Requires bespoke retry loop) |
| **Daemon Lifecycle & Teardown** | **Clean** (`bot.start()`, `bot.stop()`, supports `AbortSignal`) | **Clean** (`bot.launch()`, `bot.stop()`) | **Mixed** (`bot.stopPolling()`) | **Clean** (`AbortController.abort()`) |
| **Security Whitelisting** | **Trivial** (Middleware `ctx.from?.id` guard) | **Trivial** (Middleware `ctx.from?.id` guard) | **Manual** (Event handler guard) | **Manual** (Polling loop guard) |
| **Maintenance Burden** | **Very Low** (Active maintenance, Telegram Bot API 8.x parity) | **Low** (Stable maintenance, occasional release lag) | **High** (Slow feature adoption, legacy debt) | **High** (Must maintain Telegram Bot API schema parity) |

---

## 3. Deep-Dive Candidate Analysis

### 3.1. `grammY` (Recommended)

#### Strengths
- **Type Narrowing**: grammY’s type system uses TypeScript type predicates to narrow the `Context` object. For example, registering `bot.on("callback_query:data")` automatically informs TypeScript that `ctx.callbackQuery` and `ctx.callbackQuery.data` are defined strings.
- **Fluent UI Builders**: `InlineKeyboard` allows readable, chainable keyboard construction:
  ```typescript
  import { InlineKeyboard } from "grammy";

  const keyboard = new InlineKeyboard()
    .text("Approve (#42)", "pr:approve:42")
    .text("Reject", "pr:reject:42")
    .row()
    .text("View Diff", "pr:diff:42");
  ```
- **Error Boundaries**: Uses `bot.catch((err) => ...)` to isolate errors per update. Unhandled errors inside middleware do not kill the long-polling loop or crash the host daemon.
- **Auto-Retry & Rate Limiting**: The official `@grammyjs/auto-retry` plugin intercepts outgoing API calls. If Telegram returns `429 Too Many Requests` with `retry_after: N`, it pauses for $N$ seconds and transparently retries. For `5xx` server errors, it applies exponential backoff.
- **Concurrency Control**: Defaults to safe sequential processing per chat. If heavy concurrent processing is needed, `@grammyjs/runner` allows parallel execution while guaranteeing sequential processing per chat ID.

#### Considerations
- Adds a direct runtime dependency (`grammy` and `@grammyjs/auto-retry`). However, both are pure JavaScript/TypeScript packages with no native binary dependencies.

---

### 3.2. `telegraf`

#### Strengths
- **Maturity**: Longest-running major TypeScript framework for Telegram.
- **Middleware Standard**: Established the Koa-like onion middleware pattern for bots.
- **ESM Support**: Version 4.x supports Node.js ESM exports.

#### Weaknesses & Trade-offs
- **Typing Ergonomics**: Typing custom context requires boilerplate generic parameters (`Telegraf<MyContext>`). Callback query data typing is less strictly narrowed than in grammY.
- **Keyboard DSL**: `Markup.inlineKeyboard` is functional but more verbose with nested arrays than grammY's builder pattern.
- **Ecosystem Velocity**: grammY was created by former Telegraf core contributors to address architectural limitations in Telegraf's typing and plugin architecture.

---

### 3.3. `node-telegram-bot-api`

#### Strengths
- Simple event emitter API familiar to older Node.js developers.

#### Weaknesses & Trade-offs
- **Legacy Architecture**: Relies on `EventEmitter` rather than modern async middleware pipelines.
- **Type Definitions**: External or retrofitted TypeScript definitions have historically lagged behind Telegram Bot API releases.
- **Long-Polling Quirks**: Known edge cases with polling errors (`EFATAL`), reconnect loops, and unhandled promise rejections on network drops.
- **Not Recommended**: Unsuitable for a modern TypeScript ESM daemon with strict type safety requirements.

---

### 3.4. Minimal Native `fetch` Implementation (Custom Client)

#### Strengths
- **Zero Runtime Dependencies**: Uses Node 20+ global `fetch` and `AbortController`.
- **Absolute Control**: Zero abstraction overhead; directly hits `https://api.telegram.org/bot<TOKEN>/<METHOD>`.

#### Weaknesses & Trade-offs
- **High Maintenance**: Requires implementing custom logic for:
  1. Long-polling offset management (`offset = update.update_id + 1`).
  2. Transient network drop retries and socket hangup recovery.
  3. Exponential backoff on HTTP 429 (`retry_after`) and HTTP 502/504.
  4. Callback query routing and acknowledgement (`answerCallbackQuery`).
  5. Telegram MarkdownV2 / HTML character escaping.
- **Opportunity Cost**: Writing and testing a bulletproof long-polling engine introduces unnecessary engineering overhead compared to using `grammY`.

---

## 4. Architecture & Integration Plan for `imagos`

### 4.1. Remote Control Facade Pattern

To satisfy the requirement in Epic #16 for an extensible, provider-agnostic interface (Telegram first, Slack/Discord later), `imagos` should define a clean `RemoteControlProvider` interface.

```typescript
// src/remote/types.ts

export interface InteractiveAction {
  id: string;
  label: string;
  style?: 'primary' | 'danger' | 'default';
  payload: string;
}

export interface RemoteMessageOptions {
  chatId?: string | number;
  parseMode?: 'MarkdownV2' | 'HTML';
  actions?: InteractiveAction[][]; // Rows of buttons
}

export interface RemoteControlProvider {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(text: string, options?: RemoteMessageOptions): Promise<void>;
  onAction(actionPrefix: string, handler: (action: string, payload: string, userId: number) => Promise<void>): void;
  onCommand(command: string, handler: (args: string[], userId: number) => Promise<void>): void;
}
```

---

### 4.2. Concrete Telegram Adapter with `grammY`

```typescript
// src/remote/telegram.ts
import { Bot, InlineKeyboard, GrammyError, HttpError } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import type { RemoteControlProvider, RemoteMessageOptions, InteractiveAction } from './types.js';

export interface TelegramConfig {
  botToken: string;
  allowedUserIds: number[]; // Strict whitelist
  defaultChatId?: number | string;
}

export class TelegramRemoteProvider implements RemoteControlProvider {
  public readonly name = 'telegram';
  private bot: Bot;
  private allowedUsers: Set<number>;
  private defaultChatId?: number | string;
  private isRunning = false;

  constructor(config: TelegramConfig) {
    this.bot = new Bot(config.botToken);
    this.allowedUsers = new Set(config.allowedUserIds);
    this.defaultChatId = config.defaultChatId;

    this.setupMiddleware();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // 1. Auto-retry plugin for 429 and 5xx errors
    this.bot.api.config.use(autoRetry({
      maxRetryAttempts: 5,
      maxDelaySeconds: 60,
    }));

    // 2. Strict User Authorization Whitelist Guard
    this.bot.use(async (ctx, next) => {
      const fromId = ctx.from?.id;
      if (!fromId || !this.allowedUsers.has(fromId)) {
        console.warn(`[Telegram Security] Blocked unauthorized access attempt from ID: ${fromId}`);
        if (ctx.chat?.type === 'private') {
          await ctx.reply('⛔ Unauthorized: Your Telegram User ID is not whitelisted in imagos.');
        }
        return; // Terminate pipeline
      }
      await next();
    });
  }

  private setupErrorHandling(): void {
    this.bot.catch((err) => {
      const ctx = err.ctx;
      console.error(`[Telegram Error] Update ID ${ctx.update.update_id} failed:`, err.error);

      if (err.error instanceof GrammyError) {
        console.error(`[Telegram API Error] ${err.error.description} (code: ${err.error.error_code})`);
      } else if (err.error instanceof HttpError) {
        console.error('[Telegram Network Error] Could not reach Telegram servers:', err.error.message);
      }
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Drop pending updates on startup to avoid processing stale backlog
    await this.bot.start({
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query'],
      onStart: (botInfo) => {
        console.log(`[Telegram Remote] Connected as @${botInfo.username}. Long-polling active.`);
      },
    });
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    await this.bot.stop();
    console.log('[Telegram Remote] Bot long-polling stopped cleanly.');
  }

  public async sendMessage(text: string, options?: RemoteMessageOptions): Promise<void> {
    const targetChat = options?.chatId || this.defaultChatId;
    if (!targetChat) {
      throw new Error('[Telegram Remote] No target chatId specified.');
    }

    let replyMarkup: InlineKeyboard | undefined;
    if (options?.actions && options.actions.length > 0) {
      replyMarkup = new InlineKeyboard();
      options.actions.forEach((row, rowIndex) => {
        if (rowIndex > 0) replyMarkup!.row();
        row.forEach((action) => {
          replyMarkup!.text(action.label, `${action.id}:${action.payload}`);
        });
      });
    }

    await this.bot.api.sendMessage(targetChat, text, {
      parse_mode: options?.parseMode,
      reply_markup: replyMarkup,
    });
  }

  public onAction(
    actionPrefix: string,
    handler: (action: string, payload: string, userId: number) => Promise<void>
  ): void {
    const regex = new RegExp(`^${actionPrefix}:(.*)$`);
    this.bot.callbackQuery(regex, async (ctx) => {
      await ctx.answerCallbackQuery(); // Acknowledge button click immediately
      const payload = ctx.match[1];
      const userId = ctx.from.id;
      await handler(actionPrefix, payload, userId);
    });
  }

  public onCommand(
    command: string,
    handler: (args: string[], userId: number) => Promise<void>
  ): void {
    this.bot.command(command, async (ctx) => {
      const args = ctx.match ? ctx.match.split(/\s+/) : [];
      await handler(args, ctx.from!.id);
    });
  }
}
```

---

### 4.3. EventBus & Daemon Integration Workflow

When integrated with the `imagos` daemon:

1. **`needs-info` Feedback Routing**:
   - `Notifier.notifyTaskNeedsFeedback(issueNumber, title, question)` emits an event on `AgentEventBus`.
   - `TelegramRemoteProvider` catches the event, sends a message with inline buttons:
     - `[Provide Reply]` (triggers interactive reply mode)
     - `[Skip / Continue]`
     - `[View Issue on GitHub]` (URL button)
   - When the developer clicks `Provide Reply` or replies to the Telegram message, the bot updates the GitHub issue via GitHub API and unblocks the waiting agent worktree.

2. **5-Hour Quota Management**:
   - On `notifyQuotaPaused(resetAt, waitMinutes)`, the bot sends an alert with:
     - `[Resume Immediately]`
     - `[Extend Pause +15m]`
   - Callback immediately dispatches quota resumption command to `QuotaManager`.

3. **Graceful Daemon Teardown**:
   - The daemon binds `process.once('SIGINT')` and `process.once('SIGTERM')` to call `await telegramProvider.stop()`, ensuring all long-polling connections are cleanly terminated and avoiding `409 Conflict` errors on restart.

---

## 5. Primary Source Citations & References

1. **Telegram Bot API Official Reference**:
   - *Long Polling (`getUpdates`)*: [https://core.telegram.org/bots/api#getupdates](https://core.telegram.org/bots/api#getupdates)
   - *Inline Keyboards & Callback Queries*: [https://core.telegram.org/bots/api#inlinekeyboardmarkup](https://core.telegram.org/bots/api#inlinekeyboardmarkup) and [https://core.telegram.org/bots/api#callbackquery](https://core.telegram.org/bots/api#callbackquery)
   - *Answering Callback Queries*: [https://core.telegram.org/bots/api#answercallbackquery](https://core.telegram.org/bots/api#answercallbackquery)

2. **grammY Documentation & Source Code**:
   - *Official Guide & Architecture*: [https://grammy.dev](https://grammy.dev)
   - *Long Polling & Deployment Types*: [https://grammy.dev/guide/deployment-types#long-polling](https://grammy.dev/guide/deployment-types#long-polling)
   - *Error Handling & Boundaries*: [https://grammy.dev/guide/errors](https://grammy.dev/guide/errors)
   - *Inline Keyboards & Interactive Buttons*: [https://grammy.dev/plugins/keyboard#inline-keyboards](https://grammy.dev/plugins/keyboard#inline-keyboards)
   - *Context Narrowing & Filter Queries*: [https://grammy.dev/guide/filter-queries](https://grammy.dev/guide/filter-queries)
   - *Auto-Retry Plugin for 429/5xx*: [https://grammy.dev/plugins/auto-retry](https://grammy.dev/plugins/auto-retry)
   - *GitHub Repository*: [https://github.com/grammyjs/grammY](https://github.com/grammyjs/grammY)

3. **Telegraf Documentation & Source Code**:
   - *Telegraf Documentation*: [https://telegraf.js.org](https://telegraf.js.org)
   - *GitHub Repository*: [https://github.com/telegraf/telegraf](https://github.com/telegraf/telegraf)

4. **Node.js Specification**:
   - *Node.js Native Fetch API*: [https://nodejs.org/docs/latest-v20.x/api/globals.html#fetch](https://nodejs.org/docs/latest-v20.x/api/globals.html#fetch)
   - *Node.js ECMAScript Modules (`"type": "module"`)*: [https://nodejs.org/docs/latest-v20.x/api/esm.html](https://nodejs.org/docs/latest-v20.x/api/esm.html)
