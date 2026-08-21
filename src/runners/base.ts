import { execa } from 'execa';
import type { RunnerResult, TaskContext } from '../types/index.js';

export async function isBinaryAvailable(binaryName: string): Promise<boolean> {
  try {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'where' : 'which';
    const { exitCode } = await execa(cmd, [binaryName], { reject: false });
    return exitCode === 0;
  } catch {
    return false;
  }
}

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
  isAvailable?(): Promise<boolean>;
}

export * from './prompt.js';

