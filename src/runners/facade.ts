import type { GitHubIssue, RunnerResult, TaskContext } from '../types/index.js';
import type { AgentRunner, RunnerOptions } from './base.js';
import { RunnerRegistry } from './registry.js';
import type { QuotaMonitor } from '../quota/monitor.js';

export interface RunnerFacadeOptions {
  quotaMonitor?: QuotaMonitor;
  defaultRunner?: string;
  runnerConfig?: {
    agy?: {
      model?: string;
      effort?: 'low' | 'medium' | 'high';
      printTimeout?: string;
    };
  };
}

export class RunnerFacade {
  private registry: RunnerRegistry;
  private defaultRunner: string;
  private activeRunners: Map<number, AgentRunner> = new Map();

  constructor(options: RunnerFacadeOptions = {}) {
    this.defaultRunner = options.defaultRunner || 'claude';
    this.registry = new RunnerRegistry(options.quotaMonitor, options.runnerConfig);
  }

  public getRegistry(): RunnerRegistry {
    return this.registry;
  }

  public registerRunner(runner: AgentRunner): void {
    this.registry.register(runner);
  }

  public getRunner(name: string): AgentRunner {
    return this.registry.get(name);
  }

  public resolveRunnerName(issue: GitHubIssue, fallback?: string): string {
    const defaultName = fallback || this.defaultRunner;
    if (!issue.labels || issue.labels.length === 0) {
      return defaultName;
    }

    // Look for runner:<name> or agent:<name> label
    for (const label of issue.labels) {
      const match = label.name.match(/^(?:runner|agent):([a-zA-Z0-9_-]+)$/i);
      if (match && match[1]) {
        return match[1].toLowerCase();
      }
    }

    return defaultName;
  }

  public resolveRunner(issue: GitHubIssue, fallback?: string): AgentRunner {
    const runnerName = this.resolveRunnerName(issue, fallback);
    try {
      return this.registry.get(runnerName);
    } catch {
      // Fall back to default runner if requested runner is not registered
      return this.registry.get(this.defaultRunner);
    }
  }

  public async run(context: TaskContext, options: RunnerOptions, fallbackRunner?: string): Promise<RunnerResult> {
    const runner = this.resolveRunner(context.issue, fallbackRunner);
    this.activeRunners.set(options.issueNumber, runner);

    try {
      return await runner.run(context, options);
    } finally {
      this.activeRunners.delete(options.issueNumber);
    }
  }

  public async injectPrompt(issueNumber: number, prompt: string): Promise<boolean> {
    const active = this.activeRunners.get(issueNumber);
    if (active && typeof active.injectPrompt === 'function') {
      return await active.injectPrompt(issueNumber, prompt);
    }
    return false;
  }

  public pause(issueNumber: number): boolean {
    const active = this.activeRunners.get(issueNumber);
    if (active && typeof active.pause === 'function') {
      return active.pause(issueNumber);
    }
    return false;
  }

  public resume(issueNumber: number): boolean {
    const active = this.activeRunners.get(issueNumber);
    if (active && typeof active.resume === 'function') {
      return active.resume(issueNumber);
    }
    return false;
  }

  public async stop(issueNumber: number): Promise<void> {
    const active = this.activeRunners.get(issueNumber);
    if (active && typeof active.stop === 'function') {
      await active.stop(issueNumber);
    }
    this.activeRunners.delete(issueNumber);
  }

  public getActiveRunner(issueNumber: number): AgentRunner | undefined {
    return this.activeRunners.get(issueNumber);
  }
}
