import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';
import type { RunnerResult, TaskContext } from '../types/index.js';
import type { AgentRunner, RunnerOptions } from './base.js';
import { QuotaMonitor } from '../quota/monitor.js';

function findLatestClaudeSessionId(worktreePath: string): string | undefined {
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

export class ClaudeRunner implements AgentRunner {
  public readonly name = 'claude';
  private quotaMonitor?: QuotaMonitor;

  constructor(quotaMonitor?: QuotaMonitor) {
    this.quotaMonitor = quotaMonitor;
  }

  public buildPrompt(context: TaskContext): string {
    const { issue, isContinuation, userFeedback, extraPrompt, baseBranch = 'main' } = context;
    const issueRef = issue.url || `#${issue.number}`;

    const extraSection = extraPrompt
      ? `\n### Repository Instructions\n${extraPrompt.trim()}\n`
      : '';

    const guidelines = `### Guidelines & Protocol
1. **Feedback & Questions**: If you encounter blocking ambiguities or require clarification from the developer:
   - Post your question: \`gh issue comment ${issue.number} --body "<your question>"\`
   - Mark for developer feedback: \`gh issue edit ${issue.number} --add-label "needs-info" --remove-label "ready-for-agent"\`
   - **Immediately conclude execution and exit.** Do not guess or proceed further. Autopilot will automatically resume this session once the developer responds and re-assigns \`ready-for-agent\`.
2. **Follow-up Subtasks**: If you identify distinct out-of-scope work or follow-up subtasks:
   - Create child tickets: \`gh issue create --title "<title>" --body "Parent: #${issue.number}\\nBlocked by: #${issue.number}\\n\\n<details>" --label "ready-for-agent"\`
3. **PR, Rebase & Merge**:
   - Push your branch and open a Pull Request: \`gh pr create --title "<title>" --body "Closes #${issue.number}\\n\\n<summary>"\`
   - Rebase onto \`${baseBranch}\` and resolve any conflicts if necessary.
   - Once all tests and CI checks pass, merge the Pull Request (e.g. \`gh pr merge --squash --delete-branch\`) to close the issue.`;

    if (isContinuation && userFeedback) {
      return `/implement ${issueRef}

You are continuing work on this task following clarification from the developer.

### Developer Clarification
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

    try {
      const subprocess = execa('claude', args, {
        cwd: options.cwd,
        stdin: 'ignore',
        env: {
          ...process.env,
          CI: 'true',
        },
      });

      if (subprocess.pid && options.onPid) {
        options.onPid(subprocess.pid);
        if (this.quotaMonitor) {
          this.quotaMonitor.registerPid(subprocess.pid);
        }
      }

      subprocess.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullOutput += text;
        if (options.onOutput) options.onOutput(text);

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

        if (this.quotaMonitor) {
          const quotaCheck = this.quotaMonitor.checkOutputForRateLimit(text);
          if (quotaCheck.isRateLimited && quotaCheck.resetAt) {
            this.quotaMonitor.triggerQuotaPause(quotaCheck.resetAt, quotaCheck.reason);
          }
        }
      });

      await subprocess;

      if (subprocess.pid && this.quotaMonitor) {
        this.quotaMonitor.unregisterPid(subprocess.pid);
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
}
