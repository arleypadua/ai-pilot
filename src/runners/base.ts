import type { RunnerResult, TaskContext } from '../types/index.js';

export interface RunnerOptions {
  cwd: string;
  onOutput?: (chunk: string) => void;
  onPid?: (pid: number) => void;
}

export interface AgentRunner {
  readonly name: string;
  run(context: TaskContext, options: RunnerOptions): Promise<RunnerResult>;
}
