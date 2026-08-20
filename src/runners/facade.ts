import type { GitHubIssue, RunnerConfig, RunnerResult, TaskContext } from '../types/index.js';
import type { AgentRunner, RunnerOptions } from './base.js';
import { RunnerRegistry } from './registry.js';
import type { QuotaMonitor } from '../quota/monitor.js';

export interface RunnerFacadeOptions {
  quotaMonitor?: QuotaMonitor;
  defaultRunner?: string;
  runnerConfig?: RunnerConfig;
  allowedProviders?: string[];
}

export class RunnerFacade {
  private registry: RunnerRegistry;
  private defaultRunner: string;
  private allowedProviders?: string[];
  private activeRunners: Map<number, AgentRunner> = new Map();

  constructor(options: RunnerFacadeOptions = {}) {
    this.defaultRunner = options.defaultRunner || 'claude';
    this.allowedProviders = options.allowedProviders;
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

  public setAllowedProviders(providers?: string[]): void {
    this.allowedProviders = providers;
  }

  public getAllowedProviders(): string[] | undefined {
    return this.allowedProviders;
  }

  public setDefaultRunner(runner: string): void {
    this.defaultRunner = runner;
  }

  public getDefaultRunner(): string {
    return this.defaultRunner;
  }

  public isProviderAllowed(name: string): boolean {
    if (!this.allowedProviders) {
      return true;
    }
    return this.allowedProviders.map((p) => p.toLowerCase()).includes(name.toLowerCase());
  }

  public resolveRunnerName(issue: GitHubIssue, fallback?: string): string {
    const defaultName = fallback || this.defaultRunner;

    if (issue.labels && issue.labels.length > 0) {
      // Look for runner:<name> or agent:<name> label
      for (const label of issue.labels) {
        const match = label.name.match(/^(?:runner|agent):([a-zA-Z0-9_-]+)$/i);
        if (match && match[1]) {
          const requested = match[1].toLowerCase();
          if (this.isProviderAllowed(requested)) {
            return requested;
          }
          break;
        }
      }
    }

    if (this.isProviderAllowed(defaultName)) {
      return defaultName;
    }

    if (this.allowedProviders && this.allowedProviders.length > 0) {
      for (const p of this.allowedProviders) {
        if (this.registry.has(p)) {
          return p;
        }
      }
      return this.allowedProviders[0];
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
