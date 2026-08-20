import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { AutoPilotConfig } from '../types/index.js';

export const AgyRunnerConfigSchema = z.object({
  model: z.string().optional(),
  effort: z.string().optional(),
  printTimeout: z.string().optional(),
});

export const RunnerConfigSchema = z
  .object({
    agy: AgyRunnerConfigSchema.optional(),
  })
  .passthrough();

export const TelegramNotificationsConfigSchema = z.object({
  needsInfo: z.boolean().default(true),
  quotaPaused: z.boolean().default(true),
  taskCompleted: z.boolean().default(true),
  specCompleted: z.boolean().default(true),
});

export const TelegramRemoteConfigSchema = z.object({
  botTokenEnv: z.string().default('TELEGRAM_BOT_TOKEN'),
  allowedUserIds: z.array(z.number().int()).optional(),
  defaultChatId: z.union([z.number().int(), z.string()]).optional(),
  notifications: TelegramNotificationsConfigSchema.default({}),
});

export const RemoteControlConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    provider: z.enum(['telegram', 'slack', 'discord']).default('telegram'),
    telegram: TelegramRemoteConfigSchema.default({}),
  })
  .default({});

export const AutoPilotConfigSchema = z.object({
  repository: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, 'Repository must be in "owner/repo" format')
    .optional(),
  targetSpec: z.union([z.number().int(), z.array(z.number().int())]).optional(),
  targetSpecs: z.array(z.number().int()).optional(),
  baseBranch: z.string().default('main'),
  maxConcurrency: z.number().int().min(1).default(2),
  maxAutoNudges: z.number().int().min(0).default(2),
  maxRetriesOnFailure: z.number().int().min(0).default(2),
  maxAutoRetries: z.number().int().min(0).optional(),
  pollIntervalSeconds: z.number().int().min(5).default(30),
  extraPrompt: z.string().optional(),
  runner: z.enum(['claude', 'agy', 'pi', 'custom']).default('claude'),
  runnerConfig: RunnerConfigSchema.optional(),
  customRunnerCommand: z.string().optional(),
  autoMerge: z.boolean().default(true),
  mergeMethod: z.enum(['squash', 'merge', 'rebase']).default('squash'),
  cleanupWorktreeOnClose: z.boolean().default(true),
  remote: RemoteControlConfigSchema.default({}),
  quota: z
    .object({
      pauseOnLimit: z.boolean().default(true),
      utilizationThreshold: z.number().min(0.1).max(1.0).default(0.85),
      tokenCeiling: z.number().int().min(10000).optional(),
      proxyPort: z.number().int().optional().default(9876),
    })
    .default({}),
  labels: z
    .object({
      readyForAgent: z.string().default('ready-for-agent'),
      needsInfo: z.string().default('needs-info'),
      readyForHuman: z.string().default('ready-for-human'),
      needsTriage: z.string().default('needs-triage'),
      wontfix: z.string().default('wontfix'),
    })
    .default({}),
});

export * from './credentials.js';

export const DEFAULT_CONFIG: AutoPilotConfig = AutoPilotConfigSchema.parse({});

export function parseSpecsOption(value: string | string[], previous: number[] = []): number[] {
  const values = Array.isArray(value) ? value : [value];
  const results = [...previous];
  for (const val of values) {
    const parts = String(val).split(',');
    for (const part of parts) {
      const num = parseInt(part.trim(), 10);
      if (!isNaN(num) && !results.includes(num)) {
        results.push(num);
      }
    }
  }
  return results;
}

export async function detectRepository(cwd: string = process.cwd()): Promise<string | undefined> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd });
    const url = stdout.trim();
    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    // Git remote origin may not be configured yet
  }
  return undefined;
}

export function getConfigPath(cwd: string = process.cwd()): string {
  const dotAutopilotConfig = path.resolve(cwd, '.autopilot', 'config.json');
  const legacyConfig = path.resolve(cwd, 'autopilot.config.json');

  if (fs.existsSync(dotAutopilotConfig)) {
    return dotAutopilotConfig;
  }
  if (fs.existsSync(legacyConfig)) {
    return legacyConfig;
  }
  return dotAutopilotConfig; // Default destination
}

export async function loadConfig(
  customPath?: string,
  cwd: string = process.cwd()
): Promise<AutoPilotConfig> {
  const resolvedPath = customPath ? path.resolve(cwd, customPath) : getConfigPath(cwd);

  let fileConfig: Record<string, unknown> = {};

  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf8');
      fileConfig = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse configuration file at ${resolvedPath}: ${err}`);
    }
  }

  const parsed = AutoPilotConfigSchema.parse(fileConfig);

  if (!parsed.repository) {
    parsed.repository = await detectRepository(cwd);
  }

  return parsed;
}

export function saveConfig(
  config: Partial<AutoPilotConfig>,
  targetPath?: string,
  cwd: string = process.cwd()
): string {
  const dest = targetPath ? path.resolve(cwd, targetPath) : path.resolve(cwd, '.autopilot', 'config.json');
  const parentDir = path.dirname(dest);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const serialized = JSON.stringify(config, null, 2);
  fs.writeFileSync(dest, serialized, 'utf8');
  ensureGitIgnoreRules(cwd);
  return dest;
}

export function ensureGitIgnoreRules(cwd: string = process.cwd()): void {
  const gitignorePath = path.resolve(cwd, '.gitignore');
  const ruleBlock = `\n# Agent Auto-Pilot runtime state & worktrees\n.autopilot/*\n!.autopilot/config.json\n`;

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes('.autopilot/*')) {
      fs.appendFileSync(gitignorePath, ruleBlock, 'utf8');
    }
  } else {
    fs.writeFileSync(gitignorePath, ruleBlock, 'utf8');
  }
}
