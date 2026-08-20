import type { AgentRunner } from './base.js';
import { isBinaryAvailable } from './base.js';
import { ClaudeRunner } from './claude.js';
import { AgyRunner, type AgyRunnerConfig } from './agy.js';
import type { QuotaMonitor } from '../quota/monitor.js';
import type { AutoPilotConfig, ProviderInfo } from '../types/index.js';

export interface RegistryConfig {
  agy?: AgyRunnerConfig;
  [key: string]: unknown;
}

export const KNOWN_PROVIDERS: Array<{
  id: string;
  name: string;
  displayName: string;
  binaryName?: string;
  description: string;
}> = [
  {
    id: 'claude',
    name: 'claude',
    displayName: 'Claude Code CLI (claude)',
    binaryName: 'claude',
    description: 'Anthropic Claude Code CLI agent runner',
  },
  {
    id: 'agy',
    name: 'agy',
    displayName: 'Antigravity CLI (agy)',
    binaryName: 'agy',
    description: 'Google DeepMind Antigravity CLI agent runner',
  },
  {
    id: 'pi',
    name: 'pi',
    displayName: 'Pi CLI (pi)',
    binaryName: 'pi',
    description: 'Inflection Pi CLI agent runner',
  },
  {
    id: 'custom',
    name: 'custom',
    displayName: 'Custom Runner (custom)',
    binaryName: undefined,
    description: 'Custom user-configured runner command',
  },
];

export async function detectInstalledProviders(
  config?: Partial<AutoPilotConfig>,
  registry?: RunnerRegistry
): Promise<ProviderInfo[]> {
  const result: ProviderInfo[] = [];
  const configuredAllowed = config?.allowedProviders || config?.allowedRunners;
  const defaultRunner = config?.runner || 'claude';

  for (const p of KNOWN_PROVIDERS) {
    let isInstalled = false;
    if (p.binaryName) {
      isInstalled = await isBinaryAvailable(p.binaryName);
    } else if (p.id === 'custom') {
      isInstalled = Boolean(config?.customRunnerCommand);
    }

    if (registry && registry.has(p.id)) {
      const avail = await registry.isAvailable(p.id);
      if (avail) isInstalled = true;
    }

    let isAllowed = false;
    if (configuredAllowed !== undefined) {
      isAllowed = configuredAllowed.includes(p.id);
    } else {
      // By default any provider installed is allowed!
      isAllowed = isInstalled;
    }

    const isDefault = defaultRunner === p.id;

    result.push({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      binaryName: p.binaryName,
      description: p.description,
      isInstalled,
      isAllowed,
      isDefault,
    });
  }

  // Include any dynamically registered runners not in KNOWN_PROVIDERS
  if (registry) {
    for (const name of registry.list()) {
      if (!result.some((r) => r.id === name)) {
        const isInstalled = await registry.isAvailable(name);
        let isAllowed = false;
        if (configuredAllowed !== undefined) {
          isAllowed = configuredAllowed.includes(name);
        } else {
          isAllowed = isInstalled;
        }
        result.push({
          id: name,
          name,
          displayName: `${name} (custom registered)`,
          description: `Registered custom agent runner: ${name}`,
          isInstalled,
          isAllowed,
          isDefault: defaultRunner === name,
        });
      }
    }
  }

  return result;
}

export class RunnerRegistry {
  private runners: Map<string, AgentRunner> = new Map();

  constructor(quotaMonitor?: QuotaMonitor, runnerConfig?: RegistryConfig) {
    const claudeRunner = new ClaudeRunner(quotaMonitor);
    const agyRunner = new AgyRunner(quotaMonitor, runnerConfig?.agy);
    this.register(claudeRunner);
    this.register(agyRunner);
  }

  public register(runner: AgentRunner): void {
    this.runners.set(runner.name, runner);
  }

  public get(name: string): AgentRunner {
    const runner = this.runners.get(name);
    if (!runner) {
      throw new Error(`Runner '${name}' is not registered. Available runners: ${Array.from(this.runners.keys()).join(', ')}`);
    }
    return runner;
  }

  public has(name: string): boolean {
    return this.runners.has(name);
  }

  public list(): string[] {
    return Array.from(this.runners.keys());
  }

  public async isAvailable(name: string): Promise<boolean> {
    const runner = this.runners.get(name);
    if (!runner) return false;
    if (runner.isAvailable) {
      return runner.isAvailable();
    }
    return true;
  }

  public async detectAvailable(): Promise<string[]> {
    const available: string[] = [];
    for (const [name, runner] of this.runners.entries()) {
      if (runner.isAvailable) {
        if (await runner.isAvailable()) {
          available.push(name);
        }
      } else {
        available.push(name);
      }
    }
    return available;
  }
}
