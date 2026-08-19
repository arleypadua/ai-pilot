import type { RunnerResult, TaskContext } from '../types/index.js';

export interface RunnerOptions {
  cwd: string;
  issueNumber: number;
  onOutput?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onPid?: (pid: number) => void;
}

export interface AgentRunner {
  readonly name: string;
  run(context: TaskContext, options: RunnerOptions): Promise<RunnerResult>;
  injectPrompt?(issueNumber: number, prompt: string): Promise<boolean>;
  stop?(issueNumber: number): Promise<void>;
  pause?(issueNumber: number): boolean;
  resume?(issueNumber: number): boolean;
}
