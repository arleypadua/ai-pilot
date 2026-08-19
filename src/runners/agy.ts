import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';
import type { RunnerResult, TaskContext } from '../types/index.js';
import type { AgentRunner, RunnerOptions } from './base.js';
import { isBinaryAvailable } from './base.js';
import { QuotaMonitor } from '../quota/monitor.js';
import { AgentEventBus } from '../events/bus.js';

export interface AgyRunnerConfig {
  model?: string;
  effort?: 'low' | 'medium' | 'high' | string;
  printTimeout?: string;
}

interface ActiveProcessInfo {
  issueNumber: number;
  subprocess: any;
  isExecutingTool: boolean;
  currentTool?: string;
  pendingPrompt?: string;
  watcher?: { stop: () => void };
}

export class AgyRunner implements AgentRunner {
  public readonly name = 'agy';
  private quotaMonitor?: QuotaMonitor;
  private activeProcesses: Map<number, ActiveProcessInfo> = new Map();
  private eventBus = AgentEventBus.getInstance();
  private runnerConfig?: AgyRunnerConfig;

  constructor(quotaMonitor?: QuotaMonitor, runnerConfig?: AgyRunnerConfig) {
    this.quotaMonitor = quotaMonitor;
    this.runnerConfig = runnerConfig;
  }

  public async isAvailable(): Promise<boolean> {
    return isBinaryAvailable('agy');
  }

  public buildPrompt(context: TaskContext): string {
    const { issue, isContinuation, userFeedback, extraPrompt, baseBranch = 'main' } = context;
    const issueRef = issue.url || `#${issue.number}`;

    const extraSection = extraPrompt
      ? `\n### Repository Instructions\n${extraPrompt.trim()}\n`
      : '';

    const guidelines = `### Guidelines & Protocol
1. **Feedback, Questions & Human Review**: If you encounter blocking ambiguities, require clarification, or decide that manual human review is required before merging:
   - Post your comment or question: \`gh issue comment ${issue.number} --body "❓ **Agent Question**: <your question>"\` or explain why manual review/decision is needed.
   - Mark for developer feedback: \`gh issue edit ${issue.number} --add-label "ready-for-human" --remove-label "ready-for-agent"\` (or \`--add-label "needs-info"\`).
   - **Immediately conclude execution and exit.** Do not guess or leave the ticket in an untagged open state.
2. **Follow-up Subtasks**: If you identify distinct out-of-scope work or follow-up subtasks:
   - Create child tickets: \`gh issue create --title "<title>" --body "Parent: #${issue.number}\\nBlocked by: #${issue.number}\\n\\n<details>" --label "ready-for-agent"\`
3. **PR, Rebase & Merge**:
   - Push your branch and open a Pull Request: \`gh pr create --title "<title>" --body "Closes #${issue.number}\\n\\n<summary>"\`
   - Rebase onto \`${baseBranch}\` and resolve any conflicts if necessary.
   - Once all tests and CI checks pass, merge the Pull Request (e.g. \`gh pr merge --squash --delete-branch\`) to close the issue.`;

    if (isContinuation && userFeedback) {
      return `Implement the requested task for ${issueRef}.

You are continuing work on this task following clarification/steering from the developer.

### Developer Clarification & Steering
<developer_feedback>
${userFeedback}
</developer_feedback>

### Original Issue Description
${issue.body || 'No description provided.'}
${extraSection}
${guidelines}
`;
    }

    if (isContinuation) {
      return `Implement the requested task for ${issueRef}.

You are resuming work on this task after a session pause. Your previous conversation history and worktree state are preserved.

### Original Issue Description
${issue.body || 'No description provided.'}
${extraSection}
${guidelines}
`;
    }

    return `Implement the requested task for ${issueRef}.

### Task Description
${issue.body || 'No description provided.'}
${extraSection}
${guidelines}
`;
  }

  public async injectPrompt(issueNumber: number, prompt: string): Promise<boolean> {
    const active = this.activeProcesses.get(issueNumber);
    if (!active) {
      return false;
    }

    active.pendingPrompt = prompt;
    this.eventBus.emitAgentEvent({
      issueNumber,
      type: 'prompt_injected',
      summary: `Injected developer feedback: "${prompt}"`,
      detail: { prompt },
    });

    if (active.isExecutingTool) {
      this.eventBus.emitAgentEvent({
        issueNumber,
        type: 'info',
        summary: `Waiting for active tool (${active.currentTool || 'operation'}) to complete before safe resume...`,
      });

      const startTime = Date.now();
      while (active.isExecutingTool && Date.now() - startTime < 5000) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    try {
      active.subprocess.kill('SIGINT');
    } catch {
      // Process may already have terminated
    }

    return true;
  }

  public async stop(issueNumber: number): Promise<void> {
    const active = this.activeProcesses.get(issueNumber);
    if (active) {
      try {
        active.subprocess.kill('SIGTERM');
      } catch {}
      this.cleanupProcess(issueNumber);
    }
  }

  public pause(issueNumber: number): boolean {
    const active = this.activeProcesses.get(issueNumber);
    if (active && active.subprocess.pid) {
      try {
        process.kill(active.subprocess.pid, 'SIGSTOP');
        return true;
      } catch {}
    }
    return false;
  }

  public resume(issueNumber: number): boolean {
    const active = this.activeProcesses.get(issueNumber);
    if (active && active.subprocess.pid) {
      try {
        process.kill(active.subprocess.pid, 'SIGCONT');
        return true;
      } catch {}
    }
    return false;
  }

  private cleanupProcess(issueNumber: number): void {
    const active = this.activeProcesses.get(issueNumber);
    if (active) {
      if (active.watcher) {
        active.watcher.stop();
      }
      this.activeProcesses.delete(issueNumber);
    }
  }

  public async run(context: TaskContext, options: RunnerOptions): Promise<RunnerResult> {
    const prompt = this.buildPrompt(context);
    const args = [
      '-p',
      prompt,
      '--dangerously-skip-permissions',
    ];

    if (context.isContinuation) {
      args.unshift('--continue');
    }

    if (this.runnerConfig?.model) {
      args.push('--model', this.runnerConfig.model);
    }

    if (this.runnerConfig?.effort) {
      args.push('--effort', this.runnerConfig.effort);
    }

    if (this.runnerConfig?.printTimeout) {
      args.push('--print-timeout', this.runnerConfig.printTimeout);
    }

    let fullOutput = '';
    const issueNumber = options.issueNumber;

    try {
      const subprocess = execa('agy', args, {
        cwd: options.cwd,
        stdin: 'ignore',
        env: {
          ...process.env,
          CI: 'true',
        },
      });

      const procInfo: ActiveProcessInfo = {
        issueNumber,
        subprocess,
        isExecutingTool: false,
      };

      // Start watching AGY transcript for real-time tool calls & thoughts
      procInfo.watcher = this.startAgyWatcher(options.cwd, issueNumber, procInfo);
      this.activeProcesses.set(issueNumber, procInfo);

      if (subprocess.pid && options.onPid) {
        options.onPid(subprocess.pid);
        if (this.quotaMonitor) {
          this.quotaMonitor.registerPid(subprocess.pid, 'agy');
        }
      }

      subprocess.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullOutput += text;
        if (options.onOutput) options.onOutput(text);

        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            if (trimmed.startsWith('🔧') || trimmed.startsWith('Tool:')) {
              procInfo.isExecutingTool = true;
              this.eventBus.emitAgentEvent({
                issueNumber,
                type: 'tool_start',
                summary: trimmed,
              });
            } else {
              procInfo.isExecutingTool = false;
              this.eventBus.emitAgentEvent({
                issueNumber,
                type: 'stdout',
                summary: trimmed,
              });
            }
          }
        }

        if (this.quotaMonitor) {
          const quotaCheck = this.quotaMonitor.checkOutputForRateLimit(text);
          if (quotaCheck.isRateLimited && quotaCheck.resetAt) {
            this.quotaMonitor.triggerQuotaPause(quotaCheck.resetAt, quotaCheck.reason);
          }
        }
      });

      subprocess.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullOutput += text;
        if (options.onStderr) options.onStderr(text);
        if (options.onOutput) options.onOutput(text);

        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          if (line.trim()) {
            this.eventBus.emitAgentEvent({
              issueNumber,
              type: 'stderr',
              summary: line.trim(),
            });
          }
        }

        if (this.quotaMonitor) {
          const quotaCheck = this.quotaMonitor.checkOutputForRateLimit(text);
          if (quotaCheck.isRateLimited && quotaCheck.resetAt) {
            this.quotaMonitor.triggerQuotaPause(quotaCheck.resetAt, quotaCheck.reason);
          }
        }
      });

      await subprocess;

      const pendingPrompt = procInfo.pendingPrompt;
      this.cleanupProcess(issueNumber);

      if (subprocess.pid && this.quotaMonitor) {
        this.quotaMonitor.unregisterPid(subprocess.pid);
      }

      if (pendingPrompt) {
        return {
          success: false,
          status: 'INTERRUPTED_FOR_PROMPT',
          injectedPrompt: pendingPrompt,
          summary: `Interrupted to apply developer prompt: ${pendingPrompt.slice(0, 80)}`,
        };
      }

      if (this.quotaMonitor) {
        const quotaCheck = this.quotaMonitor.checkOutputForRateLimit(fullOutput);
        if (quotaCheck.isRateLimited) {
          return {
            success: false,
            status: 'QUOTA_PAUSED',
            quotaResetAt: quotaCheck.resetAt,
            summary: 'Execution paused due to AGY quota limits.',
          };
        }
      }

      return {
        success: true,
        status: 'COMPLETED',
        summary: fullOutput.slice(-1000),
      };
    } catch (err: any) {
      const active = this.activeProcesses.get(issueNumber);
      const pendingPrompt = active?.pendingPrompt;
      this.cleanupProcess(issueNumber);

      if (pendingPrompt) {
        return {
          success: false,
          status: 'INTERRUPTED_FOR_PROMPT',
          injectedPrompt: pendingPrompt,
          summary: `Interrupted to apply developer prompt: ${pendingPrompt.slice(0, 80)}`,
        };
      }

      if (this.quotaMonitor) {
        const quotaCheck = this.quotaMonitor.checkOutputForRateLimit(`${fullOutput}\n${err.message}`);
        if (quotaCheck.isRateLimited) {
          return {
            success: false,
            status: 'QUOTA_PAUSED',
            quotaResetAt: quotaCheck.resetAt,
            summary: 'Execution paused due to AGY quota limits.',
          };
        }
      }

      return {
        success: false,
        status: 'FAILED',
        error: err.message || String(err),
        summary: fullOutput.slice(-1000),
      };
    }
  }

  private startAgyWatcher(
    worktreePath: string,
    issueNumber: number,
    procInfo: ActiveProcessInfo
  ): { stop: () => void } {
    let lastLineCount = 0;
    let currentTranscriptPath: string | undefined;
    const startTime = Date.now() - 5000;

    const findTranscriptFile = (): string | undefined => {
      try {
        const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
        if (!fs.existsSync(brainDir)) return undefined;

        const entries = fs.readdirSync(brainDir, { withFileTypes: true });
        const dirStats: { transcriptPath: string; mtime: number }[] = [];

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const transcriptPath = path.join(brainDir, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
            if (fs.existsSync(transcriptPath)) {
              try {
                const stat = fs.statSync(transcriptPath);
                if (stat.mtimeMs >= startTime) {
                  dirStats.push({ transcriptPath, mtime: stat.mtimeMs });
                }
              } catch {}
            }
          }
        }

        if (dirStats.length === 0) return undefined;
        dirStats.sort((a, b) => b.mtime - a.mtime);

        // Check if top candidate transcript belongs to this issue or worktree
        for (const candidate of dirStats.slice(0, 5)) {
          try {
            const head = fs.readFileSync(candidate.transcriptPath, 'utf8').slice(0, 3000);
            if (
              head.includes(`issues/${issueNumber}`) ||
              head.includes(`issue-${issueNumber}`) ||
              head.includes(`Issue #${issueNumber}`) ||
              head.includes(path.basename(worktreePath))
            ) {
              return candidate.transcriptPath;
            }
          } catch {}
        }

        // Fallback to newest
        return dirStats[0].transcriptPath;
      } catch {
        return undefined;
      }
    };

    const check = () => {
      try {
        if (!currentTranscriptPath) {
          currentTranscriptPath = findTranscriptFile();
          if (!currentTranscriptPath) return;
        }

        if (!fs.existsSync(currentTranscriptPath)) return;

        const content = fs.readFileSync(currentTranscriptPath, 'utf8');
        const lines = content.split('\n').filter(Boolean);

        if (lines.length > lastLineCount) {
          const newLines = lines.slice(lastLineCount);
          lastLineCount = lines.length;

          for (const line of newLines) {
            try {
              const parsed = JSON.parse(line);

              // Tool calls
              if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
                for (const tc of parsed.tool_calls) {
                  procInfo.isExecutingTool = true;
                  procInfo.currentTool = tc.name;
                  const summary = tc.args?.toolSummary || tc.args?.toolAction || '';
                  const cmd = tc.args?.CommandLine ? `\`${tc.args.CommandLine.slice(0, 50)}\`` : '';
                  const target = tc.args?.TargetFile ? path.basename(tc.args.TargetFile) : '';
                  const detail = summary || cmd || target || tc.name;

                  this.eventBus.emitAgentEvent({
                    issueNumber,
                    type: 'tool_start',
                    summary: `🔧 ${tc.name}: ${detail}`,
                    detail: tc.args,
                  });
                }
              }
              // Model responses / thoughts
              else if (parsed.type === 'PLANNER_RESPONSE' && parsed.content) {
                const thought = parsed.content.trim();
                if (thought) {
                  this.eventBus.emitAgentEvent({
                    issueNumber,
                    type: 'thought',
                    summary: thought.slice(0, 160),
                  });
                }
              }
              // Tool execution results
              else if (parsed.type === 'GENERIC' || (parsed.source === 'MODEL' && parsed.content)) {
                procInfo.isExecutingTool = false;
                procInfo.currentTool = undefined;
                const firstLine = (parsed.content || '').split('\n')[0] || '';
                if (firstLine && !firstLine.startsWith('{')) {
                  this.eventBus.emitAgentEvent({
                    issueNumber,
                    type: 'tool_end',
                    summary: `✓ ${firstLine.slice(0, 80)}`,
                  });
                }
              }
            } catch {}
          }
        }
      } catch {}
    };

    const timer = setInterval(check, 600);
    setTimeout(check, 1000);

    return {
      stop: () => clearInterval(timer),
    };
  }
}
