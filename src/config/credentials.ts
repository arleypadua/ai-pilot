import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { z } from 'zod';
import type {
  Credentials,
  TelegramRepoCredentials,
  ResolvedTelegramCredentials,
  ResolveCredentialsOptions,
  SaveTelegramCredentialsOptions,
  CredentialSource,
} from '../types/index.js';

export const TelegramRepoCredentialsSchema = z
  .object({
    botToken: z.string().optional(),
    allowedUserIds: z.array(z.number().int()).optional(),
    defaultChatId: z.union([z.number().int(), z.string()]).optional(),
    chatId: z.union([z.number().int(), z.string()]).optional(),
  })
  .passthrough();

export const TelegramCredentialsSchema = z
  .object({
    defaultBotToken: z.string().optional(),
    botToken: z.string().optional(),
    defaultAllowedUserIds: z.array(z.number().int()).optional(),
    allowedUserIds: z.array(z.number().int()).optional(),
    defaultChatId: z.union([z.number().int(), z.string()]).optional(),
    chatId: z.union([z.number().int(), z.string()]).optional(),
    repositories: z.record(TelegramRepoCredentialsSchema).optional(),
  })
  .passthrough();

export const CredentialsSchema = z
  .object({
    telegram: TelegramCredentialsSchema.optional(),
  })
  .passthrough();

/**
 * Parses allowed user IDs from various formats: number, number array, or comma-separated string / JSON array string.
 */
export function parseAllowedUserIds(value: unknown): number[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const ids = value
      .map((item) => {
        if (typeof item === 'number' && Number.isInteger(item)) {
          return item;
        }
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (/^-?\d+$/.test(trimmed)) {
            const parsed = parseInt(trimmed, 10);
            return isNaN(parsed) ? undefined : parsed;
          }
        }
        return undefined;
      })
      .filter((item): item is number => item !== undefined);

    const uniqueIds = Array.from(new Set(ids));
    return uniqueIds.length > 0 ? uniqueIds : undefined;
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return [value];
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        return parseAllowedUserIds(parsed);
      } catch {
        // Fall through to comma-separated parsing
      }
    }

    const parts = trimmed.split(',');
    const ids = parts
      .map((part) => {
        const pTrimmed = part.trim();
        if (/^-?\d+$/.test(pTrimmed)) {
          const parsed = parseInt(pTrimmed, 10);
          return isNaN(parsed) ? undefined : parsed;
        }
        return undefined;
      })
      .filter((item): item is number => item !== undefined);

    const uniqueIds = Array.from(new Set(ids));
    return uniqueIds.length > 0 ? uniqueIds : undefined;
  }

  return undefined;
}

/**
 * Parses chat ID from integer or string.
 */
export function parseChatId(value: unknown): number | string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (/^-?\d+$/.test(trimmed)) {
      const parsed = parseInt(trimmed, 10);
      return isNaN(parsed) ? trimmed : parsed;
    }

    return trimmed;
  }

  return undefined;
}

/**
 * Returns the destination path for credentials.json (default: ~/.imagos/credentials.json).
 */
export function getCredentialsPath(homeDir?: string): string {
  const baseDir = homeDir || process.env.IMAGOS_HOME || os.homedir();
  return path.join(baseDir, '.imagos', 'credentials.json');
}

/**
 * Loads and validates credentials from ~/.imagos/credentials.json or a custom path.
 */
export function loadCredentialsFile(
  customPath?: string,
  homeDir?: string
): Credentials | null {
  const filePath = customPath ? path.resolve(customPath) : getCredentialsPath(homeDir);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return {};
    }
    const json = JSON.parse(raw);
    return CredentialsSchema.parse(json);
  } catch (err) {
    throw new Error(`Failed to parse credentials file at ${filePath}: ${err}`);
  }
}

/**
 * Saves credentials to ~/.imagos/credentials.json or a custom path with strict 0600 permissions.
 */
export function saveCredentialsFile(
  credentials: Credentials,
  customPath?: string,
  homeDir?: string
): string {
  const dest = customPath ? path.resolve(customPath) : getCredentialsPath(homeDir);
  const parentDir = path.dirname(dest);

  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
  }

  const serialized = JSON.stringify(credentials, null, 2);
  fs.writeFileSync(dest, serialized, { encoding: 'utf8', mode: 0o600 });

  try {
    fs.chmodSync(dest, 0o600);
  } catch {
    // Non-fatal on platforms without POSIX permission support
  }

  return dest;
}

/**
 * Helper to update and save Telegram credentials (global or per-repository).
 */
export function saveTelegramCredentials(options: SaveTelegramCredentialsOptions = {}): string {
  let credentials: Credentials = {};

  try {
    const existing = loadCredentialsFile(options.customPath, options.homeDir);
    if (existing) {
      credentials = existing;
    }
  } catch {
    // If existing credentials file is unreadable, start fresh
  }

  if (!credentials.telegram) {
    credentials.telegram = {};
  }

  const telegram = credentials.telegram;

  if (options.repository) {
    if (!telegram.repositories) {
      telegram.repositories = {};
    }

    const repoCreds: TelegramRepoCredentials = telegram.repositories[options.repository] || {};

    if (options.botToken !== undefined) {
      repoCreds.botToken = options.botToken;
    }
    if (options.allowedUserIds !== undefined) {
      repoCreds.allowedUserIds = options.allowedUserIds;
    }
    if (options.defaultChatId !== undefined) {
      repoCreds.defaultChatId = options.defaultChatId;
    }

    telegram.repositories[options.repository] = repoCreds;
  } else {
    if (options.botToken !== undefined) {
      telegram.defaultBotToken = options.botToken;
    }
    if (options.allowedUserIds !== undefined) {
      telegram.defaultAllowedUserIds = options.allowedUserIds;
    }
    if (options.defaultChatId !== undefined) {
      telegram.defaultChatId = options.defaultChatId;
    }
  }

  return saveCredentialsFile(credentials, options.customPath, options.homeDir);
}

/**
 * Resolves Telegram credentials across 3 tiers in hierarchical priority order:
 * 1. Local repository .env file
 * 2. User credentials file (~/.imagos/credentials.json), checking repository override then global
 * 3. Process environment variables (process.env)
 * 4. Configuration object fallback (for allowedUserIds / defaultChatId)
 */
export function resolveTelegramCredentials(
  options: ResolveCredentialsOptions = {}
): ResolvedTelegramCredentials {
  const botTokenEnvKey = options.config?.remote?.telegram?.botTokenEnv || 'TELEGRAM_BOT_TOKEN';

  // 1. Tier 1: Parse local repository .env file
  const cwd = options.cwd || process.cwd();
  const envFile = options.envPath ? path.resolve(options.envPath) : path.resolve(cwd, '.env');
  let envParsed: Record<string, string> = {};

  if (fs.existsSync(envFile)) {
    try {
      envParsed = dotenv.parse(fs.readFileSync(envFile, 'utf8'));
    } catch {
      // Ignore unparseable .env
    }
  }

  // 2. Tier 2: Load ~/.imagos/credentials.json
  const credentials = loadCredentialsFile(options.credentialsPath, options.homeDir);

  const repo = options.repository || options.config?.repository;
  const repoCreds = repo && credentials?.telegram?.repositories ? credentials.telegram.repositories[repo] : undefined;
  const globalCreds = credentials?.telegram;

  // 3. Tier 3: Process environment
  const processEnv = options.env || process.env;

  // Track sources
  let botToken: string | undefined;
  let botTokenSource: CredentialSource = 'none';

  let allowedUserIds: number[] | undefined;
  let allowedUserIdsSource: CredentialSource = 'none';

  let defaultChatId: number | string | undefined;
  let defaultChatIdSource: CredentialSource = 'none';

  // Resolve Bot Token (Tier 1 -> Tier 2a -> Tier 2b -> Tier 3)
  if (envParsed[botTokenEnvKey]?.trim()) {
    botToken = envParsed[botTokenEnvKey].trim();
    botTokenSource = 'env_file';
  } else if (botTokenEnvKey !== 'TELEGRAM_BOT_TOKEN' && envParsed['TELEGRAM_BOT_TOKEN']?.trim()) {
    botToken = envParsed['TELEGRAM_BOT_TOKEN'].trim();
    botTokenSource = 'env_file';
  } else if (repoCreds?.botToken?.trim()) {
    botToken = repoCreds.botToken.trim();
    botTokenSource = 'credentials_file_repo';
  } else if (globalCreds?.defaultBotToken?.trim()) {
    botToken = globalCreds.defaultBotToken.trim();
    botTokenSource = 'credentials_file_global';
  } else if (globalCreds?.botToken?.trim()) {
    botToken = globalCreds.botToken.trim();
    botTokenSource = 'credentials_file_global';
  } else if (processEnv[botTokenEnvKey]?.trim()) {
    botToken = processEnv[botTokenEnvKey].trim();
    botTokenSource = 'process_env';
  } else if (botTokenEnvKey !== 'TELEGRAM_BOT_TOKEN' && processEnv['TELEGRAM_BOT_TOKEN']?.trim()) {
    botToken = processEnv['TELEGRAM_BOT_TOKEN'].trim();
    botTokenSource = 'process_env';
  }

  // Resolve Allowed User IDs (Tier 1 -> Tier 2a -> Tier 2b -> Tier 3 -> Config)
  const envUsers = parseAllowedUserIds(envParsed['TELEGRAM_ALLOWED_USER_IDS'] || envParsed['TELEGRAM_USER_IDS']);
  if (envUsers && envUsers.length > 0) {
    allowedUserIds = envUsers;
    allowedUserIdsSource = 'env_file';
  } else if (repoCreds?.allowedUserIds && repoCreds.allowedUserIds.length > 0) {
    const parsed = parseAllowedUserIds(repoCreds.allowedUserIds);
    if (parsed && parsed.length > 0) {
      allowedUserIds = parsed;
      allowedUserIdsSource = 'credentials_file_repo';
    }
  }

  if (!allowedUserIds && (globalCreds?.defaultAllowedUserIds || globalCreds?.allowedUserIds)) {
    const parsed = parseAllowedUserIds(globalCreds.defaultAllowedUserIds || globalCreds.allowedUserIds);
    if (parsed && parsed.length > 0) {
      allowedUserIds = parsed;
      allowedUserIdsSource = 'credentials_file_global';
    }
  }

  if (!allowedUserIds) {
    const procUsers = parseAllowedUserIds(processEnv['TELEGRAM_ALLOWED_USER_IDS'] || processEnv['TELEGRAM_USER_IDS']);
    if (procUsers && procUsers.length > 0) {
      allowedUserIds = procUsers;
      allowedUserIdsSource = 'process_env';
    }
  }

  if (!allowedUserIds && options.config?.remote?.telegram?.allowedUserIds && options.config.remote.telegram.allowedUserIds.length > 0) {
    allowedUserIds = options.config.remote.telegram.allowedUserIds;
    allowedUserIdsSource = 'config';
  }

  // Resolve Default Chat ID (Tier 1 -> Tier 2a -> Tier 2b -> Tier 3 -> Config)
  const envChat = parseChatId(envParsed['TELEGRAM_CHAT_ID'] || envParsed['TELEGRAM_DEFAULT_CHAT_ID']);
  if (envChat !== undefined) {
    defaultChatId = envChat;
    defaultChatIdSource = 'env_file';
  } else if (repoCreds && (repoCreds.defaultChatId !== undefined || repoCreds.chatId !== undefined)) {
    const parsed = parseChatId(repoCreds.defaultChatId !== undefined ? repoCreds.defaultChatId : repoCreds.chatId);
    if (parsed !== undefined) {
      defaultChatId = parsed;
      defaultChatIdSource = 'credentials_file_repo';
    }
  }

  if (defaultChatId === undefined && globalCreds && (globalCreds.defaultChatId !== undefined || globalCreds.chatId !== undefined)) {
    const parsed = parseChatId(globalCreds.defaultChatId !== undefined ? globalCreds.defaultChatId : globalCreds.chatId);
    if (parsed !== undefined) {
      defaultChatId = parsed;
      defaultChatIdSource = 'credentials_file_global';
    }
  }

  if (defaultChatId === undefined) {
    const procChat = parseChatId(processEnv['TELEGRAM_CHAT_ID'] || processEnv['TELEGRAM_DEFAULT_CHAT_ID']);
    if (procChat !== undefined) {
      defaultChatId = procChat;
      defaultChatIdSource = 'process_env';
    }
  }

  if (defaultChatId === undefined && options.config?.remote?.telegram?.defaultChatId !== undefined) {
    defaultChatId = options.config.remote.telegram.defaultChatId;
    defaultChatIdSource = 'config';
  }

  return {
    botToken,
    allowedUserIds,
    defaultChatId,
    source: {
      botToken: botTokenSource,
      allowedUserIds: allowedUserIdsSource,
      defaultChatId: defaultChatIdSource,
    },
  };
}
