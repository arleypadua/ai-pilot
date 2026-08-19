import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { AutoPilotConfig } from '../types/index.js';

export const AutoPilotConfigSchema = z.object({
  repository: z.string().optional(),
  baseBranch: z.string().default('main'),
  maxConcurrency: z.number().int().min(1).default(2),
  pollIntervalSeconds: z.number().int().min(5).default(30),
  runner: z.enum(['claude', 'agy', 'pi', 'custom']).default('claude'),
  customRunnerCommand: z.string().optional(),
  testCommand: z.string().default('npm test'),
  autoMerge: z.boolean().default(true),
  mergeMethod: z.enum(['squash', 'merge', 'rebase']).default('squash'),
  cleanupWorktreeOnClose: z.boolean().default(true),
  quota: z
    .object({
      pauseOnLimit: z.boolean().default(true),
      utilizationThreshold: z.number().min(0.1).max(1.0).default(0.95),
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

export const DEFAULT_CONFIG: AutoPilotConfig = AutoPilotConfigSchema.parse({});

export async function detectRepository(cwd: string = process.cwd()): Promise<string | undefined> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd });
    const url = stdout.trim();
    // Parse git@github.com:owner/repo.git or https://github.com/owner/repo.git
    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    // Git remote origin may not be configured yet
  }
  return undefined;
}

export async function loadConfig(
  configPath?: string,
  cwd: string = process.cwd()
): Promise<AutoPilotConfig> {
  const resolvedPath = configPath
    ? path.resolve(cwd, configPath)
    : path.resolve(cwd, 'autopilot.config.json');

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

export function saveConfig(config: Partial<AutoPilotConfig>, targetPath: string = 'autopilot.config.json'): void {
  const serialized = JSON.stringify(config, null, 2);
  fs.writeFileSync(targetPath, serialized, 'utf8');
}
