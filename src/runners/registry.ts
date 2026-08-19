import type { AgentRunner } from './base.js';
import { ClaudeRunner } from './claude.js';
import { AgyRunner, type AgyRunnerConfig } from './agy.js';
import type { QuotaMonitor } from '../quota/monitor.js';

export interface RegistryConfig {
  agy?: AgyRunnerConfig;
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
