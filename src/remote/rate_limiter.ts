export type RequestPriority = 'high' | 'normal' | 'low';

export interface RateLimiterOptions {
  minChatIntervalMs?: number; // Minimum interval between messages to the same chat (default: 1000ms = 1 msg/s)
  minGlobalIntervalMs?: number; // Minimum interval between global API calls (default: 34ms ≈ 30 msg/s)
  retryAfterBufferMs?: number; // Additional safety buffer added to 429 retry_after (default: 200ms)
  defaultMaxRetries?: number; // Maximum retries on 429 errors (default: 3)
}

export interface EnqueueOptions {
  priority?: RequestPriority;
  maxRetries?: number;
}

interface QueuedItem<T = any> {
  id: string;
  chatId: string | number;
  fn: () => Promise<T>;
  priority: RequestPriority;
  retries: number;
  maxRetries: number;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  enqueuedAt: number;
}

export class TelegramRateLimiter {
  private minChatIntervalMs: number;
  private minGlobalIntervalMs: number;
  private retryAfterBufferMs: number;
  private defaultMaxRetries: number;

  private queue: QueuedItem[] = [];
  private lastChatSendTime: Map<string | number, number> = new Map();
  private lastGlobalSendTime: number = 0;
  private pausedUntil: number = 0;
  private isProcessing: boolean = false;
  private timer?: NodeJS.Timeout;
  private isDestroyed: boolean = false;

  constructor(options: RateLimiterOptions = {}) {
    this.minChatIntervalMs = options.minChatIntervalMs ?? 1000;
    this.minGlobalIntervalMs = options.minGlobalIntervalMs ?? 34;
    this.retryAfterBufferMs = options.retryAfterBufferMs ?? 200;
    this.defaultMaxRetries = options.defaultMaxRetries ?? 3;
  }

  public async enqueue<T>(
    chatId: string | number,
    fn: () => Promise<T>,
    options: EnqueueOptions = {}
  ): Promise<T> {
    if (this.isDestroyed) {
      throw new Error('RateLimiter is destroyed');
    }

    return new Promise<T>((resolve, reject) => {
      const item: QueuedItem<T> = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        chatId,
        fn,
        priority: options.priority ?? 'normal',
        retries: 0,
        maxRetries: options.maxRetries ?? this.defaultMaxRetries,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      this.insertQueueItem(item);
      this.scheduleProcessing();
    });
  }

  public isPaused(): boolean {
    return Date.now() < this.pausedUntil;
  }

  public getPausedUntil(): number {
    return this.pausedUntil;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public pause(durationMs: number): void {
    const target = Date.now() + durationMs;
    if (target > this.pausedUntil) {
      this.pausedUntil = target;
    }
    this.scheduleProcessing();
  }

  public clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const error = new Error('RateLimiter queue cleared');
    for (const item of this.queue) {
      item.reject(error);
    }
    this.queue = [];
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.clear();
  }

  private insertQueueItem(item: QueuedItem): void {
    const priorityWeight: Record<RequestPriority, number> = {
      high: 0,
      normal: 1,
      low: 2,
    };

    const itemWeight = priorityWeight[item.priority];
    const index = this.queue.findIndex(
      (existing) => priorityWeight[existing.priority] > itemWeight
    );

    if (index === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(index, 0, item);
    }
  }

  private scheduleProcessing(): void {
    if (this.isDestroyed || this.isProcessing) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.queue.length === 0) {
      return;
    }

    const now = Date.now();

    // Check if globally paused due to 429
    if (now < this.pausedUntil) {
      const waitTime = this.pausedUntil - now;
      this.timer = setTimeout(() => this.processQueue(), waitTime);
      return;
    }

    // Check global rate limit
    const timeSinceGlobal = now - this.lastGlobalSendTime;
    const globalWait = Math.max(0, this.minGlobalIntervalMs - timeSinceGlobal);

    // Find the earliest ready item based on per-chat limit
    let minWait = Infinity;
    let hasReadyItem = false;

    for (const item of this.queue) {
      const lastChat = this.lastChatSendTime.get(item.chatId) ?? 0;
      const timeSinceChat = now - lastChat;
      const chatWait = Math.max(0, this.minChatIntervalMs - timeSinceChat);
      const totalWait = Math.max(globalWait, chatWait);

      if (totalWait === 0) {
        hasReadyItem = true;
        break;
      }
      if (totalWait < minWait) {
        minWait = totalWait;
      }
    }

    if (hasReadyItem) {
      this.processQueue();
    } else if (minWait !== Infinity) {
      this.timer = setTimeout(() => this.processQueue(), minWait);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isDestroyed || this.isProcessing || this.queue.length === 0) {
      return;
    }

    const now = Date.now();
    if (now < this.pausedUntil) {
      this.scheduleProcessing();
      return;
    }

    // Find first item ready to dispatch (highest priority item whose chat is not throttled)
    const timeSinceGlobal = now - this.lastGlobalSendTime;
    if (timeSinceGlobal < this.minGlobalIntervalMs) {
      this.scheduleProcessing();
      return;
    }

    let targetIndex = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i];
      const lastChat = this.lastChatSendTime.get(item.chatId) ?? 0;
      if (now - lastChat >= this.minChatIntervalMs) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex === -1) {
      this.scheduleProcessing();
      return;
    }

    const [item] = this.queue.splice(targetIndex, 1);
    const executionTime = Date.now();
    this.lastGlobalSendTime = executionTime;
    this.lastChatSendTime.set(item.chatId, executionTime);

    this.isProcessing = true;

    try {
      const result = await item.fn();
      this.isProcessing = false;
      item.resolve(result);
      this.scheduleProcessing();
    } catch (error: any) {
      this.isProcessing = false;
      const retryAfter = this.extractRetryAfter(error);

      if (retryAfter !== undefined) {
        const pauseMs = retryAfter * 1000 + this.retryAfterBufferMs;
        this.pause(pauseMs);

        if (item.retries < item.maxRetries) {
          item.retries++;
          // Re-insert at top of queue for retry
          this.queue.unshift(item);
          this.scheduleProcessing();
          return;
        }
      }

      item.reject(error);
      this.scheduleProcessing();
    }
  }

  private extractRetryAfter(error: any): number | undefined {
    if (!error) return undefined;

    // Check grammY / Telegram API parameters
    if (typeof error.parameters?.retry_after === 'number') {
      return error.parameters.retry_after;
    }

    // Check response body / properties
    if (typeof error.retry_after === 'number') {
      return error.retry_after;
    }

    if (typeof error.response?.parameters?.retry_after === 'number') {
      return error.response.parameters.retry_after;
    }

    // Check status code 429
    if (error.status === 429 || error.statusCode === 429 || error.error_code === 429) {
      // Default fallback backoff if retry_after is not specified
      return 5;
    }

    // Check error message for 429 / Too Many Requests / retry after
    const message = error.message || String(error);
    const match = message.match(/retry after (\d+)/i) || message.match(/Too Many Requests: retry after (\d+)/i);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }

    if (message.includes('429') || message.includes('Too Many Requests')) {
      return 5;
    }

    return undefined;
  }
}
