import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseAllowedUserIds,
  parseAllowedChatIds,
  parseChatId,
  getCredentialsPath,
  getUserConfigPath,
  loadCredentialsFile,
  saveCredentialsFile,
  loadUserConfig,
  saveUserConfig,
  saveTelegramBot,
  getTelegramBot,
  saveTelegramCredentials,
  resolveTelegramCredentials,
  CredentialsSchema,
  TelegramCredentialsSchema,
  TelegramRepoCredentialsSchema,
  UserConfigSchema,
  GlobalTelegramConfigSchema,
  TelegramBotConfigSchema,
} from '../src/config/credentials.js';

describe('Credentials schemas and parser helpers', () => {
  describe('parseAllowedUserIds', () => {
    it('returns undefined for null, undefined, or empty string', () => {
      expect(parseAllowedUserIds(undefined)).toBeUndefined();
      expect(parseAllowedUserIds(null)).toBeUndefined();
      expect(parseAllowedUserIds('')).toBeUndefined();
      expect(parseAllowedUserIds('   ')).toBeUndefined();
    });

    it('parses single integer number or single integer string', () => {
      expect(parseAllowedUserIds(123456789)).toEqual([123456789]);
      expect(parseAllowedUserIds('123456789')).toEqual([123456789]);
    });

    it('parses array of numbers and string numbers', () => {
      expect(parseAllowedUserIds([123, 456, 789])).toEqual([123, 456, 789]);
      expect(parseAllowedUserIds(['123', '456'])).toEqual([123, 456]);
      expect(parseAllowedUserIds([123, '456'])).toEqual([123, 456]);
    });

    it('parses comma-separated string of user IDs', () => {
      expect(parseAllowedUserIds('123, 456, 789')).toEqual([123, 456, 789]);
      expect(parseAllowedUserIds('  123  ,  456  ')).toEqual([123, 456]);
    });

    it('parses JSON string array', () => {
      expect(parseAllowedUserIds('[123456789, 987654321]')).toEqual([123456789, 987654321]);
    });

    it('filters out invalid tokens, floats, and NaNs', () => {
      expect(parseAllowedUserIds('123, abc, 456, NaN, 12.34')).toEqual([123, 456]);
      expect(parseAllowedUserIds([123, 12.34, NaN, 'abc', 456])).toEqual([123, 456]);
    });

    it('deduplicates user IDs', () => {
      expect(parseAllowedUserIds([123, 456, 123, 456])).toEqual([123, 456]);
      expect(parseAllowedUserIds('123, 456, 123')).toEqual([123, 456]);
    });
  });

  describe('parseChatId', () => {
    it('returns undefined for undefined, null, or empty string', () => {
      expect(parseChatId(undefined)).toBeUndefined();
      expect(parseChatId(null)).toBeUndefined();
      expect(parseChatId('')).toBeUndefined();
      expect(parseChatId('   ')).toBeUndefined();
    });

    it('parses positive and negative integer numbers', () => {
      expect(parseChatId(123456789)).toBe(123456789);
      expect(parseChatId(-1001234567890)).toBe(-1001234567890);
    });

    it('parses numeric strings into integers', () => {
      expect(parseChatId('123456789')).toBe(123456789);
      expect(parseChatId('-1001234567890')).toBe(-1001234567890);
    });

    it('preserves non-numeric strings such as channel usernames', () => {
      expect(parseChatId('@my_channel')).toBe('@my_channel');
      expect(parseChatId('channel_name')).toBe('channel_name');
    });
  });

  describe('Zod credential schemas', () => {
    it('TelegramRepoCredentialsSchema parses valid repo credentials', () => {
      const parsed = TelegramRepoCredentialsSchema.parse({
        botToken: '123456:ABC-DEF',
        allowedUserIds: [123456789],
        defaultChatId: -1001234567890,
      });
      expect(parsed.botToken).toBe('123456:ABC-DEF');
      expect(parsed.allowedUserIds).toEqual([123456789]);
      expect(parsed.defaultChatId).toBe(-1001234567890);
    });

    it('TelegramCredentialsSchema parses global and per-repository credentials', () => {
      const parsed = TelegramCredentialsSchema.parse({
        defaultBotToken: 'global:token',
        defaultAllowedUserIds: [111],
        defaultChatId: '@global_chat',
        repositories: {
          'owner/special-repo': {
            botToken: 'repo:token',
            allowedUserIds: [222],
            defaultChatId: -999,
          },
        },
      });
      expect(parsed.defaultBotToken).toBe('global:token');
      expect(parsed.repositories?.['owner/special-repo']?.botToken).toBe('repo:token');
    });

    it('CredentialsSchema allows passthrough for future providers', () => {
      const parsed = CredentialsSchema.parse({
        telegram: {
          defaultBotToken: 'token',
        },
        slack: {
          webhookUrl: 'https://hooks.slack.com/services/...',
        },
      });
      expect(parsed.telegram?.defaultBotToken).toBe('token');
      expect((parsed as any).slack?.webhookUrl).toBe('https://hooks.slack.com/services/...');
    });
  });
});

describe('Credentials file persistence and operations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagos-creds-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getCredentialsPath', () => {
    it('returns path under provided homeDir', () => {
      const p = getCredentialsPath(tmpDir);
      expect(p).toBe(path.join(tmpDir, '.imagos', 'credentials.json'));
    });

    it('respects IMAGOS_HOME environment variable if homeDir is not provided', () => {
      const prev = process.env.IMAGOS_HOME;
      try {
        process.env.IMAGOS_HOME = tmpDir;
        expect(getCredentialsPath()).toBe(path.join(tmpDir, '.imagos', 'credentials.json'));
      } finally {
        if (prev !== undefined) {
          process.env.IMAGOS_HOME = prev;
        } else {
          delete process.env.IMAGOS_HOME;
        }
      }
    });
  });

  describe('loadCredentialsFile and saveCredentialsFile', () => {
    it('returns null if credentials file does not exist', () => {
      expect(loadCredentialsFile(undefined, tmpDir)).toBeNull();
    });

    it('saves credentials and loads them back accurately', () => {
      const creds = {
        telegram: {
          defaultBotToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          defaultAllowedUserIds: [123456789],
          repositories: {
            'owner/repo': {
              botToken: '987654:XYZ-repo-token',
            },
          },
        },
      };

      const savedPath = saveCredentialsFile(creds, undefined, tmpDir);
      expect(fs.existsSync(savedPath)).toBe(true);

      if (process.platform !== 'win32') {
        const stats = fs.statSync(savedPath);
        // Check permissions: mode 0600 (owner read/write only)
        const fileMode = stats.mode & 0o777;
        expect(fileMode).toBe(0o600);
      }

      const loaded = loadCredentialsFile(undefined, tmpDir);
      expect(loaded).toEqual(creds);
    });

    it('handles empty credentials file', () => {
      const credsPath = path.join(tmpDir, '.imagos', 'credentials.json');
      fs.mkdirSync(path.dirname(credsPath), { recursive: true });
      fs.writeFileSync(credsPath, '', 'utf8');

      const loaded = loadCredentialsFile(credsPath);
      expect(loaded).toEqual({});
    });

    it('throws descriptive error on invalid JSON in credentials file', () => {
      const credsPath = path.join(tmpDir, '.imagos', 'credentials.json');
      fs.mkdirSync(path.dirname(credsPath), { recursive: true });
      fs.writeFileSync(credsPath, '{ invalid json', 'utf8');

      expect(() => loadCredentialsFile(credsPath)).toThrow(/Failed to parse credentials file/);
    });
  });

  describe('saveTelegramCredentials', () => {
    it('saves global Telegram credentials', () => {
      saveTelegramCredentials({
        botToken: 'global-bot-token',
        allowedUserIds: [12345],
        defaultChatId: 99999,
        homeDir: tmpDir,
      });

      const loaded = loadCredentialsFile(undefined, tmpDir);
      expect(loaded?.telegram?.defaultBotToken).toBe('global-bot-token');
      expect(loaded?.telegram?.defaultAllowedUserIds).toEqual([12345]);
      expect(loaded?.telegram?.defaultChatId).toBe(99999);
    });

    it('saves per-repository credentials and preserves existing global credentials', () => {
      saveTelegramCredentials({
        botToken: 'global-token',
        allowedUserIds: [111],
        homeDir: tmpDir,
      });

      saveTelegramCredentials({
        repository: 'owner/special-repo',
        botToken: 'special-token',
        allowedUserIds: [222, 333],
        defaultChatId: -1001234567890,
        homeDir: tmpDir,
      });

      const loaded = loadCredentialsFile(undefined, tmpDir);
      expect(loaded?.telegram?.defaultBotToken).toBe('global-token');
      expect(loaded?.telegram?.defaultAllowedUserIds).toEqual([111]);
      expect(loaded?.telegram?.repositories?.['owner/special-repo']).toEqual({
        botToken: 'special-token',
        allowedUserIds: [222, 333],
        defaultChatId: -1001234567890,
      });
    });
  });
});

describe('resolveTelegramCredentials across hierarchical tiers', () => {
  let tmpRepoDir: string;
  let tmpHomeDir: string;

  beforeEach(() => {
    tmpRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagos-repo-'));
    tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagos-home-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRepoDir, { recursive: true, force: true });
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  });

  describe('Tier 1: Local .env precedence', () => {
    it('resolves botToken and allowedUserIds from .env when all 3 tiers exist', () => {
      // 1. .env file
      const envPath = path.join(tmpRepoDir, '.env');
      fs.writeFileSync(
        envPath,
        'TELEGRAM_BOT_TOKEN=env-token-123\nTELEGRAM_ALLOWED_USER_IDS=100,200\nTELEGRAM_CHAT_ID=-1001\n',
        'utf8'
      );

      // 2. ~/.imagos/credentials.json
      saveTelegramCredentials({
        botToken: 'global-cred-token',
        allowedUserIds: [300],
        repository: 'owner/my-repo',
        homeDir: tmpHomeDir,
      });

      // 3. process.env
      const mockEnv: NodeJS.ProcessEnv = {
        TELEGRAM_BOT_TOKEN: 'proc-env-token',
        TELEGRAM_ALLOWED_USER_IDS: '400',
        TELEGRAM_CHAT_ID: '-2002',
      };

      const resolved = resolveTelegramCredentials({
        cwd: tmpRepoDir,
        homeDir: tmpHomeDir,
        repository: 'owner/my-repo',
        env: mockEnv,
      });

      expect(resolved.botToken).toBe('env-token-123');
      expect(resolved.allowedUserIds).toEqual([100, 200]);
      expect(resolved.defaultChatId).toBe(-1001);
      expect(resolved.source).toEqual({
        botToken: 'env_file',
        allowedUserIds: 'env_file',
        defaultChatId: 'env_file',
      });
    });
  });

  describe('Tier 2a: credentials.json repository override precedence', () => {
    it('resolves repository-specific credentials over global credentials and process.env', () => {
      // 1. ~/.imagos/credentials.json with global and repo overrides
      saveTelegramCredentials({
        botToken: 'global-cred-token',
        allowedUserIds: [111],
        homeDir: tmpHomeDir,
      });

      saveTelegramCredentials({
        repository: 'owner/my-repo',
        botToken: 'repo-override-token',
        allowedUserIds: [222],
        defaultChatId: -3003,
        homeDir: tmpHomeDir,
      });

      // 2. process.env
      const mockEnv: NodeJS.ProcessEnv = {
        TELEGRAM_BOT_TOKEN: 'proc-env-token',
        TELEGRAM_ALLOWED_USER_IDS: '333',
        TELEGRAM_CHAT_ID: '-4004',
      };

      const resolved = resolveTelegramCredentials({
        cwd: tmpRepoDir, // No .env here
        homeDir: tmpHomeDir,
        repository: 'owner/my-repo',
        env: mockEnv,
      });

      expect(resolved.botToken).toBe('repo-override-token');
      expect(resolved.allowedUserIds).toEqual([222]);
      expect(resolved.defaultChatId).toBe(-3003);
      expect(resolved.source).toEqual({
        botToken: 'credentials_file_repo',
        allowedUserIds: 'credentials_file_repo',
        defaultChatId: 'credentials_file_repo',
      });
    });
  });

  describe('Tier 2b: credentials.json global precedence', () => {
    it('resolves global credentials when repository override and .env are not present', () => {
      // 1. ~/.imagos/credentials.json with global credentials only
      saveTelegramCredentials({
        botToken: 'global-cred-token',
        allowedUserIds: [555, 666],
        defaultChatId: '@global_channel',
        homeDir: tmpHomeDir,
      });

      // 2. process.env
      const mockEnv: NodeJS.ProcessEnv = {
        TELEGRAM_BOT_TOKEN: 'proc-env-token',
        TELEGRAM_ALLOWED_USER_IDS: '777',
      };

      const resolved = resolveTelegramCredentials({
        cwd: tmpRepoDir,
        homeDir: tmpHomeDir,
        repository: 'owner/different-repo',
        env: mockEnv,
      });

      expect(resolved.botToken).toBe('global-cred-token');
      expect(resolved.allowedUserIds).toEqual([555, 666]);
      expect(resolved.defaultChatId).toBe('@global_channel');
      expect(resolved.source).toEqual({
        botToken: 'credentials_file_global',
        allowedUserIds: 'credentials_file_global',
        defaultChatId: 'credentials_file_global',
      });
    });
  });

  describe('Tier 3: Process environment precedence', () => {
    it('resolves from process.env when .env and credentials.json are absent', () => {
      const mockEnv: NodeJS.ProcessEnv = {
        TELEGRAM_BOT_TOKEN: 'proc-env-token',
        TELEGRAM_ALLOWED_USER_IDS: '888, 999',
        TELEGRAM_CHAT_ID: '-5005',
      };

      const resolved = resolveTelegramCredentials({
        cwd: tmpRepoDir,
        homeDir: tmpHomeDir,
        repository: 'owner/any-repo',
        env: mockEnv,
      });

      expect(resolved.botToken).toBe('proc-env-token');
      expect(resolved.allowedUserIds).toEqual([888, 999]);
      expect(resolved.defaultChatId).toBe(-5005);
      expect(resolved.source).toEqual({
        botToken: 'process_env',
        allowedUserIds: 'process_env',
        defaultChatId: 'process_env',
      });
    });
  });

  describe('Tier 4: Config object fallback', () => {
    it('falls back to config object for allowedUserIds and defaultChatId', () => {
      const mockEnv: NodeJS.ProcessEnv = {
        TELEGRAM_BOT_TOKEN: 'proc-token',
      };

      const resolved = resolveTelegramCredentials({
        cwd: tmpRepoDir,
        homeDir: tmpHomeDir,
        config: {
          remote: {
            enabled: true,
            provider: 'telegram',
            telegram: {
              botTokenEnv: 'TELEGRAM_BOT_TOKEN',
              allowedUserIds: [12345],
              defaultChatId: 67890,
              notifications: {
                needsInfo: true,
                quotaPaused: true,
                taskCompleted: true,
                specCompleted: true,
              },
            },
          },
        },
        env: mockEnv,
      });

      expect(resolved.botToken).toBe('proc-token');
      expect(resolved.allowedUserIds).toEqual([12345]);
      expect(resolved.defaultChatId).toBe(67890);
      expect(resolved.source).toEqual({
        botToken: 'process_env',
        allowedUserIds: 'config',
        defaultChatId: 'config',
      });
    });
  });

  describe('Custom botTokenEnv support', () => {
    it('reads custom environment variable name specified in config from .env', () => {
      const envPath = path.join(tmpRepoDir, '.env');
      fs.writeFileSync(
        envPath,
        'CUSTOM_BOT_TOKEN=custom-env-secret\nTELEGRAM_BOT_TOKEN=standard-secret\n',
        'utf8'
      );

      const resolved = resolveTelegramCredentials({
        cwd: tmpRepoDir,
        homeDir: tmpHomeDir,
        config: {
          remote: {
            enabled: true,
            provider: 'telegram',
            telegram: {
              botTokenEnv: 'CUSTOM_BOT_TOKEN',
              notifications: {
                needsInfo: true,
                quotaPaused: true,
                taskCompleted: true,
                specCompleted: true,
              },
            },
          },
        },
        env: {},
      });

      expect(resolved.botToken).toBe('custom-env-secret');
      expect(resolved.source.botToken).toBe('env_file');
    });

    it('reads custom environment variable name specified in config from process.env', () => {
      const mockEnv: NodeJS.ProcessEnv = {
        CUSTOM_BOT_TOKEN: 'proc-custom-secret',
        TELEGRAM_BOT_TOKEN: 'proc-standard-secret',
      };

      const resolved = resolveTelegramCredentials({
        cwd: tmpRepoDir,
        homeDir: tmpHomeDir,
        config: {
          remote: {
            enabled: true,
            provider: 'telegram',
            telegram: {
              botTokenEnv: 'CUSTOM_BOT_TOKEN',
              notifications: {
                needsInfo: true,
                quotaPaused: true,
                taskCompleted: true,
                specCompleted: true,
              },
            },
          },
        },
        env: mockEnv,
      });

      expect(resolved.botToken).toBe('proc-custom-secret');
      expect(resolved.source.botToken).toBe('process_env');
    });
  });

  describe('Mixed tier resolution and edge cases', () => {
    it('resolves different fields from different tiers', () => {
      // .env only has bot token
      const envPath = path.join(tmpRepoDir, '.env');
      fs.writeFileSync(envPath, 'TELEGRAM_BOT_TOKEN=env-token\n', 'utf8');

      // credentials.json has allowedUserIds
      saveTelegramCredentials({
        allowedUserIds: [101, 102],
        homeDir: tmpHomeDir,
      });

      // process.env has defaultChatId
      const mockEnv: NodeJS.ProcessEnv = {
        TELEGRAM_CHAT_ID: '-9999',
      };

      const resolved = resolveTelegramCredentials({
        cwd: tmpRepoDir,
        homeDir: tmpHomeDir,
        env: mockEnv,
      });

      expect(resolved.botToken).toBe('env-token');
      expect(resolved.allowedUserIds).toEqual([101, 102]);
      expect(resolved.defaultChatId).toBe(-9999);
      expect(resolved.source).toEqual({
        botToken: 'env_file',
        allowedUserIds: 'credentials_file_global',
        defaultChatId: 'process_env',
      });
    });

    it('returns undefined and source: none when no credentials exist anywhere', () => {
      const resolved = resolveTelegramCredentials({
        cwd: tmpRepoDir,
        homeDir: tmpHomeDir,
        env: {},
      });

      expect(resolved.botToken).toBeUndefined();
      expect(resolved.allowedUserIds).toBeUndefined();
      expect(resolved.defaultChatId).toBeUndefined();
      expect(resolved.source).toEqual({
        botToken: 'none',
        allowedUserIds: 'none',
        defaultChatId: 'none',
      });
    });

    it('ignores empty strings in environment variables and credentials', () => {
      const envPath = path.join(tmpRepoDir, '.env');
      fs.writeFileSync(envPath, 'TELEGRAM_BOT_TOKEN=\nTELEGRAM_ALLOWED_USER_IDS=\n', 'utf8');

      const mockEnv: NodeJS.ProcessEnv = {
        TELEGRAM_BOT_TOKEN: 'valid-proc-token',
        TELEGRAM_ALLOWED_USER_IDS: '789',
      };

      const resolved = resolveTelegramCredentials({
        cwd: tmpRepoDir,
        homeDir: tmpHomeDir,
        env: mockEnv,
      });

      expect(resolved.botToken).toBe('valid-proc-token');
      expect(resolved.allowedUserIds).toEqual([789]);
      expect(resolved.source.botToken).toBe('process_env');
      expect(resolved.source.allowedUserIds).toBe('process_env');
    });
  });

  describe('parseAllowedChatIds helper', () => {
    it('returns undefined for null, undefined, or empty string', () => {
      expect(parseAllowedChatIds(undefined)).toBeUndefined();
      expect(parseAllowedChatIds(null)).toBeUndefined();
      expect(parseAllowedChatIds('')).toBeUndefined();
      expect(parseAllowedChatIds('   ')).toBeUndefined();
    });

    it('parses numbers and string chat IDs including negative group chat IDs', () => {
      expect(parseAllowedChatIds(123456789)).toEqual([123456789]);
      expect(parseAllowedChatIds(-1001234567890)).toEqual([-1001234567890]);
      expect(parseAllowedChatIds('123456789, -1001234567890')).toEqual([123456789, -1001234567890]);
      expect(parseAllowedChatIds(['123456789', '-1001234567890'])).toEqual([123456789, -1001234567890]);
    });

    it('parses JSON array of chat IDs', () => {
      expect(parseAllowedChatIds('[123456789, -1001234567890]')).toEqual([123456789, -1001234567890]);
    });

    it('deduplicates chat IDs', () => {
      expect(parseAllowedChatIds([123, 456, 123])).toEqual([123, 456]);
    });
  });

  describe('Global User Configuration (~/.imagos/config.json)', () => {
    it('saves and loads global user config with multi-bot credentials', () => {
      const userConfig = {
        telegram: {
          bots: {
            '@imagos_backend_bot': {
              token: 'token-backend-123',
              allowedChatIds: [123456789],
            },
            '@imagos_frontend_bot': {
              token: 'token-frontend-456',
              allowedChatIds: [123456789, -1001234567890],
            },
          },
        },
      };

      const savedPath = saveUserConfig(userConfig, undefined, tmpHomeDir);
      expect(fs.existsSync(savedPath)).toBe(true);

      const loaded = loadUserConfig(undefined, tmpHomeDir);
      expect(loaded?.telegram?.bots?.['@imagos_backend_bot']?.token).toBe('token-backend-123');
      expect(loaded?.telegram?.bots?.['@imagos_backend_bot']?.allowedChatIds).toEqual([123456789]);
      expect(loaded?.telegram?.bots?.['@imagos_frontend_bot']?.token).toBe('token-frontend-456');
      expect(loaded?.telegram?.bots?.['@imagos_frontend_bot']?.allowedChatIds).toEqual([123456789, -1001234567890]);
    });

    it('saveTelegramBot adds and updates bots cleanly in ~/.imagos/credentials.json', () => {
      saveTelegramBot('@imagos_backend_bot', { token: 'token-1', allowedChatIds: [111] }, undefined, tmpHomeDir);
      saveTelegramBot({ botHandle: '@imagos_frontend_bot', token: 'token-2', allowedChatIds: [222], homeDir: tmpHomeDir });

      const bot1 = getTelegramBot('@imagos_backend_bot', undefined, tmpHomeDir);
      const bot2 = getTelegramBot('imagos_frontend_bot', undefined, tmpHomeDir);

      expect(bot1?.token).toBe('token-1');
      expect(bot1?.allowedChatIds).toEqual([111]);
      expect(bot2?.token).toBe('token-2');
      expect(bot2?.allowedChatIds).toEqual([222]);
    });
  });

  describe('Multi-Bot Resolution & Fail-Fast Validation (Issue #35)', () => {
    it('resolves bot credentials from ~/.imagos/credentials.json when telegram.bot is defined in repo config', () => {
      saveTelegramBot('@imagos_backend_bot', { token: 'backend-token', allowedChatIds: [123456789] }, undefined, tmpHomeDir);

      const resolved = resolveTelegramCredentials({
        homeDir: tmpHomeDir,
        cwd: tmpRepoDir,
        config: {
          telegram: {
            enabled: true,
            bot: '@imagos_backend_bot',
          },
        },
      });

      expect(resolved.botHandle).toBe('@imagos_backend_bot');
      expect(resolved.botToken).toBe('backend-token');
      expect(resolved.allowedChatIds).toEqual([123456789]);
      expect(resolved.source.botToken).toBe('user_config');
    });

    it('isolates different bots for simultaneous backend and frontend repos without collisions', () => {
      saveTelegramBot('@imagos_backend_bot', { token: 'backend-token', allowedChatIds: [100] }, undefined, tmpHomeDir);
      saveTelegramBot('@imagos_frontend_bot', { token: 'frontend-token', allowedChatIds: [200, -1001] }, undefined, tmpHomeDir);

      const backendResolved = resolveTelegramCredentials({
        homeDir: tmpHomeDir,
        cwd: tmpRepoDir,
        config: {
          telegram: {
            enabled: true,
            bot: '@imagos_backend_bot',
          },
        },
      });

      const frontendResolved = resolveTelegramCredentials({
        homeDir: tmpHomeDir,
        cwd: tmpRepoDir,
        config: {
          telegram: {
            enabled: true,
            bot: '@imagos_frontend_bot',
          },
        },
      });

      expect(backendResolved.botToken).toBe('backend-token');
      expect(backendResolved.allowedChatIds).toEqual([100]);
      expect(frontendResolved.botToken).toBe('frontend-token');
      expect(frontendResolved.allowedChatIds).toEqual([200, -1001]);
    });

    it('throws fail-fast error when Telegram is enabled but no telegram.bot is defined', () => {
      expect(() =>
        resolveTelegramCredentials({
          homeDir: tmpHomeDir,
          cwd: tmpRepoDir,
          config: {
            telegram: {
              enabled: true,
            },
          },
        })
      ).toThrow("Telegram is enabled, but no 'telegram.bot' handle is defined in .autopilot/config.json.");
    });

    it('throws fail-fast error when bot handle is not found in ~/.imagos/credentials.json', () => {
      expect(() =>
        resolveTelegramCredentials({
          homeDir: tmpHomeDir,
          cwd: tmpRepoDir,
          config: {
            telegram: {
              enabled: true,
              bot: '@non_existent_bot',
            },
          },
        })
      ).toThrow("Bot handle '@non_existent_bot' not found in ~/.imagos/credentials.json. Run 'imagos init' to configure it.");
    });

    it('prioritizes IMAGOS_TELEGRAM_BOT_TOKEN environment variable override', () => {
      saveTelegramBot('@imagos_backend_bot', { token: 'config-token', allowedChatIds: [123456789] }, undefined, tmpHomeDir);

      const resolved = resolveTelegramCredentials({
        homeDir: tmpHomeDir,
        cwd: tmpRepoDir,
        config: {
          telegram: {
            enabled: true,
            bot: '@imagos_backend_bot',
          },
        },
        env: {
          IMAGOS_TELEGRAM_BOT_TOKEN: 'override-token-999',
        },
      });

      expect(resolved.botToken).toBe('override-token-999');
      expect(resolved.source.botToken).toBe('env_override');
      expect(resolved.allowedChatIds).toEqual([123456789]);
    });
  });
});
