import { execa } from 'execa';
import type { RunnerResult, TaskContext } from '../types/index.js';
import type { AgentRunner, RunnerOptions } from './base.js';
import { QuotaMonitor } from '../quota/monitor.js';

export class ClaudeRunner implements AgentRunner {
  public readonly name = 'claude';
  private quotaMonitor?: QuotaMonitor;

  constructor(quotaMonitor?: QuotaMonitor) {
    this.quotaMonitor = quotaMonitor;
  }

  public buildPrompt(context: TaskContext): string {
    const { issue, isContinuation, userFeedback } = context;

    if (isContinuation && userFeedback) {
      return `/implement Resume Issue #${issue.number}: ${issue.title}

You are continuing work on this task following clarification from the developer.

### Developer Clarification
<developer_feedback>
${userFeedback}
</developer_feedback>

### Original Issue Description
${issue.body || 'No description provided.'}

### Guidelines
1. Check current git status, inspect changes already made, and complete the implementation according to the clarification.
2. Run test suites to verify that tests pass.
3. If you need further clarification, comment with \`gh issue comment ${issue.number} --body "..."\` and add label \`gh issue edit ${issue.number} --add-label "needs-info" --remove-label "ready-for-agent"\`.
4. If you discover distinct follow-up subtasks, create them via \`gh issue create --title "..." --body "Parent: #${issue.number}..." --label "ready-for-agent"\`.
`;
    }

    return `/implement Issue #${issue.number}: ${issue.title}

### Task Description
${issue.body || 'No description provided.'}

### Guidelines & Protocol
1. Implement the requested feature or fix in its entirety.
2. Ensure existing tests pass and add new tests covering your changes.
3. If you encounter blocking ambiguities or questions for the developer:
   - Post your question using: \`gh issue comment ${issue.number} --body "<your question>"\`
   - Mark for feedback using: \`gh issue edit ${issue.number} --add-label "needs-info" --remove-label "ready-for-agent"\`
4. If you identify outstanding work that should be a separate child ticket:
   - Create it using: \`gh issue create --title "<title>" --body "Parent: #${issue.number}\nBlocked by: #${issue.number}\n\n<details>" --label "ready-for-agent"\`
5. Do not modify files outside the scope of this issue.
`;
  }

  public async run(context: TaskContext, options: RunnerOptions): Promise<RunnerResult> {
    const prompt = this.buildPrompt(context);
    const args = [
      '-p',
      prompt,
      '--allowedTools',
      '*',
    ];

    let fullOutput = '';

    try {
      const subprocess = execa('claude', args, {
        cwd: options.cwd,
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
