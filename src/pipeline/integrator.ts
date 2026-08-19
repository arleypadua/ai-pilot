import type { AutoPilotConfig, GitHubIssue } from '../types/index.js';
import { GitHubClient } from '../github/client.js';
import { WorktreeManager } from '../worktree/manager.js';
import { Notifier } from '../notifications/notifier.js';

export interface IntegrationResult {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
  rebasePassed: boolean;
}

export class Integrator {
  private config: AutoPilotConfig;
  private gh: GitHubClient;
  private worktreeMgr: WorktreeManager;

  constructor(config: AutoPilotConfig, gh: GitHubClient, worktreeMgr: WorktreeManager) {
    this.config = config;
    this.gh = gh;
    this.worktreeMgr = worktreeMgr;
  }

  public async integrateAndMerge(
    issue: GitHubIssue,
    worktreePath: string,
    branchName: string,
    taskSummary?: string
  ): Promise<IntegrationResult> {
    // 1. Commit all modified files if not committed yet
    await this.worktreeMgr.commitAll(
      worktreePath,
      `feat(issue-${issue.number}): ${issue.title}\n\nAutomated implementation by Agent Auto-Pilot`
    );

    // 2. Rebase onto latest baseBranch (main)
    const rebaseRes = await this.worktreeMgr.rebaseWorktree(worktreePath, this.config.baseBranch);
    if (!rebaseRes.success) {
      await this.worktreeMgr.abortRebase(worktreePath);
      return {
        success: false,
        rebasePassed: false,
        error: `Rebase onto ${this.config.baseBranch} failed with conflicts. Needs manual or agent resolution.`,
      };
    }

    // 3. Push branch to remote
    try {
      await this.worktreeMgr.pushBranch(worktreePath, branchName, true);
    } catch (err: any) {
      return {
        success: false,
        rebasePassed: true,
        error: `Failed to push branch ${branchName}: ${err.message}`,
      };
    }

    // 4. Create Pull Request
    const prBody = `## Summary
Automated implementation for #${issue.number} (${issue.title}).

${taskSummary ? `### Agent Notes\n${taskSummary}\n` : ''}
Closes #${issue.number}
`;

    let prUrl = '';
    let prNumber = 0;

    try {
      const prRes = await this.gh.createPR({
        title: `feat(issue-${issue.number}): ${issue.title}`,
        body: prBody,
        head: branchName,
        base: this.config.baseBranch,
      });
      prUrl = prRes.url;
      prNumber = prRes.number;
    } catch (err: any) {
      return {
        success: false,
        rebasePassed: true,
        error: `Failed to create PR: ${err.message}`,
      };
    }

    // 5. Auto-Merge PR if enabled
    if (this.config.autoMerge && prNumber) {
      try {
        await this.gh.mergePR(prNumber, this.config.mergeMethod, true);
        Notifier.notifyTaskMerged(issue.number, issue.title, prUrl);
      } catch (err: any) {
        console.warn(`PR created at ${prUrl} but auto-merge could not complete: ${err.message}`);
      }
    }

    // 6. Close issue if not already closed
    try {
      await this.gh.closeIssue(issue.number, `Resolved automatically by PR ${prUrl}`);
    } catch {
      // Issue might be closed automatically by GitHub PR keyword
    }

    // 7. Clean up worktree and local branch
    if (this.config.cleanupWorktreeOnClose) {
      await this.worktreeMgr.cleanupWorktree(issue.number, issue.title, true);
    }

    return {
      success: true,
      prUrl,
      prNumber,
      rebasePassed: true,
    };
  }
}
