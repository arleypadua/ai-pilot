import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';
import type { RunnerResult, TaskContext } from '../types/index.js';
import type { AgentRunner, RunnerOptions } from './base.js';
import { isBinaryAvailable } from './base.js';
import { QuotaMonitor } from '../quota/monitor.js';
import { AgentEventBus } from '../events/bus.js';

export function findLatestClaudeSessionId(worktreePath: string): string | undefined {
  try {
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(claudeProjectsDir)) return undefined;

    const sanitizedPath = worktreePath.replace(/\//g, '-');
    const projectDirs = fs.readdirSync(claudeProjectsDir);
    const matchDir = projectDirs.find((d) => d.includes(path.basename(worktreePath)) || d === sanitizedPath);

    if (matchDir) {
      const fullMatchPath = path.join(claudeProjectsDir, matchDir);
      const files = fs.readdirSync(fullMatchPath).filter((f) => f.endsWith('.jsonl'));
      if (files.length > 0) {
        const stats = files.map((f) => ({
          file: f,
          mtime: fs.statSync(path.join(fullMatchPath, f)).mtimeMs,
        }));
        stats.sort((a, b) => b.mtime - a.mtime);
        return stats[0].file.replace(/\.jsonl$/, '');
      }
    }
  } catch {}
  return undefined;
}

interface ActiveProcessInfo {
  issueNumber: number;
  subprocess: any;
  isExecutingTool: boolean;
  currentTool?: string;
  pendingPrompt?: string;
  watcher?: { stop: () => void };
}

export class ClaudeRunner implements AgentRunner {
  public readonly name = 'claude';
  private quotaMonitor?: QuotaMonitor;
  private activeProcesses: Map<number, ActiveProcessInfo> = new Map();
  private eventBus = AgentEventBus.getInstance();

  constructor(quotaMonitor?: QuotaMonitor) {
    this.quotaMonitor = quotaMonitor;
  }

  public async isAvailable(): Promise<boolean> {
    return isBinaryAvailable('claude');
  }

  public buildPrompt(context: TaskContext): string {
    const {
      issue,
      isContinuation,
      userFeedback,
      extraPrompt,
      baseBranch = 'main',
      autoMerge = true,
      mergeMethod = 'squash',
    } = context;
    const issueRef = issue.url || `#${issue.number}`;

    const extraSection = extraPrompt
      ? `\n### Repository Instructions\n${extraPrompt.trim()}\n`
      : '';

    const mergeGuideline = autoMerge
      ? `- Once all tests, review, and CI checks pass, merge the Pull Request (e.g. \`gh pr merge --${mergeMethod} --delete-branch\`) to close the issue.`
      : `- Once all tests and CI checks pass, leave the Pull Request open for developer review and merge (do not auto-merge).`;

    const guidelines = `### Guidelines & Protocol
1. **Feedback, Questions & Human Review**: If you encounter blocking ambiguities, require clarification, or decide that manual human review is required before merging:
   - Post your comment or question: \`gh issue comment ${issue.number} --body "❓ **Agent Question**: <your question>"\` or explain why manual review/decision is needed.
   - Mark for developer feedback: \`gh issue edit ${issue.number} --add-label "ready-for-human" --remove-label "ready-for-agent"\` (or \`--add-label "needs-info"\`).
   - **Immediately conclude execution and exit.** Do not guess or leave the ticket in an untagged open state.
2. **Follow-up Subtasks**: If you identify distinct out-of-scope work or follow-up subtasks:
   - Create child tickets: \`gh issue create --title "<title>" --body "Parent: #${issue.number}\\nBlocked by: #${issue.number}\\n\\n<details>" --label "ready-for-agent"\`
3. **Review, PR, Rebase & Merge**:
   - Verify changes with tests and code review (e.g. \`/code-review\`). If review and tests were already completed in a prior turn, do not repeat them redundantly.
   - Push your branch and open a Pull Request: \`gh pr create --title "<title>" --body "Closes #${issue.number}\\n\\n<summary>"\`
   - Rebase onto \`${baseBranch}\` and resolve any conflicts if necessary.
   ${mergeGuideline}`;

    if (isContinuation && userFeedback) {
      return `/implement ${issueRef}

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
      return `/implement ${issueRef}

You are resuming work on this task after a session pause. Your previous conversation history, loaded files, and worktree state are restored.

### Original Issue Description
${issue.body || 'No description provided.'}
${extraSection}
${guidelines}
`;
    }

    return `/implement ${issueRef}

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

    // Wait if tool call is currently running (up to 5s) for graceful completion
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
      // Subprocess might already have exited
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
      const previousSessionId = findLatestClaudeSessionId(options.cwd);
      if (previousSessionId) {
        args.unshift('--resume', previousSessionId);
      }
    }

    let fullOutput = '';
    const issueNumber = options.issueNumber;

    try {
      const subprocess = execa('claude', args, {
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

      // Start watching Claude's project JSONL for real-time tool calls & thoughts
      procInfo.watcher = this.startClaudeWatcher(options.cwd, issueNumber, procInfo);
      this.activeProcesses.set(issueNumber, procInfo);

      if (subprocess.pid && options.onPid) {
        options.onPid(subprocess.pid);
        if (this.quotaMonitor) {
          this.quotaMonitor.registerPid(subprocess.pid, 'claude');
        }
      }

      subprocess.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullOutput += text;
        if (options.onOutput) options.onOutput(text);

        // Stream raw stdout lines to event bus
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          if (line.trim()) {
            this.eventBus.emitAgentEvent({
              issueNumber,
              type: 'stdout',
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

      // Check if prompt was injected while running
      if (pendingPrompt) {
        return {
          success: false,
          status: 'INTERRUPTED_FOR_PROMPT',
          injectedPrompt: pendingPrompt,
          summary: `Interrupted to apply developer prompt: ${pendingPrompt.slice(0, 80)}`,
        };
      }

      // Check if quota limit was met in output
      if (this.quotaMonitor) {
        const quotaCheck = this.quotaMonitor.checkOutputForRateLimit(fullOutput);
        if (quotaCheck.isRateLimited) {
          return {
            success: false,
            status: 'QUOTA_PAUSED',
            quotaResetAt: quotaCheck.resetAt,
            summary: 'Execution paused due to 5-hour rolling quota limit.',
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
            summary: 'Execution paused due to Claude quota limits.',
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

  private startClaudeWatcher(
    worktreePath: string,
    issueNumber: number,
    procInfo: ActiveProcessInfo
  ): { stop: () => void } {
    let lastLineCount = 0;
    let currentFile: string | undefined;

    const check = () => {
      try {
        const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
        if (!fs.existsSync(claudeProjectsDir)) return;

        const sanitizedPath = worktreePath.replace(/\//g, '-');
        const projectDirs = fs.readdirSync(claudeProjectsDir);
        const matchDir = projectDirs.find((d) => d.includes(path.basename(worktreePath)) || d === sanitizedPath);
        if (!matchDir) return;

        const fullMatchPath = path.join(claudeProjectsDir, matchDir);
        const files = fs.readdirSync(fullMatchPath).filter((f) => f.endsWith('.jsonl'));
        if (files.length === 0) return;

        const stats = files.map((f) => ({
          file: f,
          mtime: fs.statSync(path.join(fullMatchPath, f)).mtimeMs,
        }));
        stats.sort((a, b) => b.mtime - a.mtime);
        const latestFile = path.join(fullMatchPath, stats[0].file);

        if (latestFile !== currentFile) {
          currentFile = latestFile;
          lastLineCount = 0;
        }

        const content = fs.readFileSync(latestFile, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        if (lines.length > lastLineCount) {
          const newLines = lines.slice(lastLineCount);
          lastLineCount = lines.length;

          for (const line of newLines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'assistant' && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === 'tool_use') {
                    procInfo.isExecutingTool = true;
                    procInfo.currentTool = block.name;
                    const inputSummary = block.input ? JSON.stringify(block.input).slice(0, 100) : '';
                    this.eventBus.emitAgentEvent({
                      issueNumber,
                      type: 'tool_start',
                      summary: `🔧 ${block.name}: ${inputSummary}`,
                      detail: { name: block.name, input: block.input },
                    });
                  } else if (block.type === 'text' && block.text) {
                    const text = block.text.trim();
                    if (text) {
                      this.eventBus.emitAgentEvent({
                        issueNumber,
                        type: 'thought',
                        summary: text,
                      });
                    }
                  }
                }
              } else if (parsed.type === 'user' && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === 'tool_result') {
                    procInfo.isExecutingTool = false;
                    procInfo.currentTool = undefined;
                    this.eventBus.emitAgentEvent({
                      issueNumber,
                      type: 'tool_end',
                      summary: `✓ Tool result received`,
                      detail: { toolUseId: block.tool_use_id },
                    });
                  }
                }
              }
            } catch {}
          }
        }
      } catch {}
    };

    const timer = setInterval(check, 600);
    // Initial check after short delay
    setTimeout(check, 300);

    return {
      stop: () => clearInterval(timer),
    };
  }
}
