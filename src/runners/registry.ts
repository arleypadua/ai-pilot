import type { AgentRunner } from './base.js';
import { ClaudeRunner } from './claude.js';
import { QuotaMonitor } from '../quota/monitor.js';

export class RunnerRegistry {
  private runners: Map<string, AgentRunner> = new Map();

  constructor(quotaMonitor?: QuotaMonitor) {
    const claudeRunner = new ClaudeRunner(quotaMonitor);
    this.register(claudeRunner);
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
}
