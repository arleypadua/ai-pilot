import path from 'node:path';
import fs from 'node:fs';
import type { AutoPilotConfig, DAGNode, GitHubIssue } from '../types/index.js';
import { GitHubClient } from '../github/client.js';
import { IssueDAG } from '../github/dag.js';
import { WorktreeManager } from '../worktree/manager.js';
import { QuotaMonitor } from '../quota/monitor.js';
import { RunnerRegistry } from '../runners/registry.js';
import { Integrator } from './integrator.js';
import { Notifier } from '../notifications/notifier.js';
import { Dashboard } from '../ui/dashboard.js';

export class Orchestrator {
  private config: AutoPilotConfig;
  private gh: GitHubClient;
  private dag: IssueDAG;
  private worktreeMgr: WorktreeManager;
  private quotaMonitor: QuotaMonitor;
  private runners: RunnerRegistry;
  private integrator: Integrator;
  private dashboard: Dashboard;

  private isRunning: boolean = false;
  private pollTimer?: NodeJS.Timeout;
  private activeTaskNumbers: Set<number> = new Set();
  private lastKnownFeedbackQuestions: Map<number, string> = new Map();

  constructor(config: AutoPilotConfig) {
    this.config = config;
    this.gh = new GitHubClient({ repository: config.repository });
    this.dag = new IssueDAG(config);
    this.worktreeMgr = new WorktreeManager();
    this.quotaMonitor = new QuotaMonitor();
    this.runners = new RunnerRegistry(this.quotaMonitor);
    this.integrator = new Integrator(config, this.gh, this.worktreeMgr);
    this.dashboard = new Dashboard(config);

    // Setup quota event listeners
    this.quotaMonitor.on('quota_paused', ({ resetAt, waitMs }) => {
      const waitMinutes = Math.ceil(waitMs / (60 * 1000));
      Notifier.notifyQuotaPaused(resetAt, waitMinutes);
      this.dashboard.log(`5h Quota limit hit. Suspended workers until ${resetAt.toLocaleTimeString()}`);
    });

    this.quotaMonitor.on('quota_resumed', () => {
      this.dashboard.log('Quota reset window reached. Resuming workers.');
    });
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    this.dashboard.log('Agent Auto-Pilot started.');

    // Check GitHub Auth
    const isAuthed = await this.gh.checkAuth();
    if (!isAuthed) {
      throw new Error('gh CLI is not authenticated. Please run `gh auth login` first.');
    }

    // Main polling loop
    const runLoop = async () => {
      if (!this.isRunning) return;

      try {
        await this.tick();
      } catch (err: any) {
        this.dashboard.log(`Tick error: ${err.message}`);
      }

      if (this.isRunning) {
        this.pollTimer = setTimeout(runLoop, this.config.pollIntervalSeconds * 1000);
      }
    };

    await runLoop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.dashboard.log('Agent Auto-Pilot stopped.');
  }

  public async tick(): Promise<void> {
    // 1. Fetch latest issues
    const issues = await this.gh.fetchIssues();
    this.dag.build(issues);

    // 2. Refresh UI Dashboard
    this.dashboard.render(this.dag.getAllNodes(), this.quotaMonitor.getStatus());

    // 3. If Quota is paused, do not dispatch new tasks
    if (this.quotaMonitor.getStatus().isPaused) {
      return;
    }

    // 4. Check for tasks needing feedback notification
    for (const node of this.dag.getWaitingFeedbackNodes()) {
      if (!this.lastKnownFeedbackQuestions.has(node.issue.number)) {
        // Extract latest comment from issue if available
        const latestComment = node.issue.comments?.[node.issue.comments.length - 1]?.body;
        this.lastKnownFeedbackQuestions.set(node.issue.number, latestComment || 'Waiting for human input');
        Notifier.notifyTaskNeedsFeedback(node.issue.number, node.issue.title, latestComment);
        this.dashboard.log(`Issue #${node.issue.number} flagged for human feedback.`);
      }
    }

    // 5. Identify ready candidates
    const readyNodes = this.dag.getReadyNodes();

    for (const node of readyNodes) {
      // Clear from feedback map if previously parked
      if (this.lastKnownFeedbackQuestions.has(node.issue.number)) {
        this.lastKnownFeedbackQuestions.delete(node.issue.number);
      }

      // Check concurrency
      if (this.activeTaskNumbers.size >= this.config.maxConcurrency) {
        break;
      }

      if (this.activeTaskNumbers.has(node.issue.number)) {
        continue;
      }

      // Dispatch task in background
      this.activeTaskNumbers.add(node.issue.number);
      this.executeTask(node).finally(() => {
        this.activeTaskNumbers.delete(node.issue.number);
        this.dashboard.removeWorker(node.issue.number);
      });
    }
  }

  private async executeTask(node: DAGNode): Promise<void> {
    const { issue } = node;
    const isContinuation = await this.worktreeMgr.worktreeExists(issue.number);

    this.dashboard.log(`Dispatching Issue #${issue.number}: ${issue.title} ${isContinuation ? '(resuming)' : ''}`);

    let worktreePath = '';
    let branchName = '';

    try {
      // 1. Create or get Worktree
      const wtInfo = await this.worktreeMgr.createWorktree(
        issue.number,
        issue.title,
        this.config.baseBranch
      );
      worktreePath = wtInfo.worktreePath;
      branchName = wtInfo.branchName;

      this.dashboard.updateWorker({
        issueNumber: issue.number,
        title: issue.title,
        branchName,
        status: 'running',
        startedAt: new Date(),
      });

      // 2. Check if there is user feedback on the issue (latest comment)
      let userFeedback: string | undefined = undefined;
      if (isContinuation && issue.comments && issue.comments.length > 0) {
        userFeedback = issue.comments[issue.comments.length - 1].body;
      }

      // 3. Run Agent with /implement skill
      const runner = this.runners.get(this.config.runner);
      const runnerRes = await runner.run(
        {
          issue,
          kind: node.kind,
          worktreePath,
          branchName,
          baseBranch: this.config.baseBranch,
          isContinuation,
          userFeedback,
        },
        {
          cwd: worktreePath,
          onOutput: (chunk) => {
            // Stream output handler
          },
        }
      );

      // Check if runner paused due to quota
      if (runnerRes.status === 'QUOTA_PAUSED') {
        this.dashboard.updateWorker({
          issueNumber: issue.number,
          title: issue.title,
          branchName,
          status: 'paused_quota',
          startedAt: new Date(),
        });
        this.dashboard.log(`Issue #${issue.number} paused due to quota.`);
        return;
      }

      // Check if runner or agent changed label to needs-info / ready-for-human
      const updatedIssue = await this.gh.viewIssue(issue.number);
      const hasFeedbackLabel = updatedIssue.labels.some((l) =>
        [this.config.labels.needsInfo, this.config.labels.readyForHuman].includes(l.name)
      );

      if (hasFeedbackLabel || runnerRes.status === 'NEEDS_INFO') {
        this.dashboard.log(`Issue #${issue.number} parked awaiting developer feedback.`);
        return;
      }

      // 4. If Completed, run Integration & Merge Pipeline
      if (runnerRes.success || runnerRes.status === 'COMPLETED') {
        this.dashboard.updateWorker({
          issueNumber: issue.number,
          title: issue.title,
          branchName,
          status: 'testing',
          startedAt: new Date(),
        });

        this.dashboard.log(`Running tests & merging Issue #${issue.number}...`);

        const integrationRes = await this.integrator.integrateAndMerge(
          issue,
          worktreePath,
          branchName,
          runnerRes.summary
        );

        if (integrationRes.success) {
          this.dashboard.log(`Successfully merged & closed Issue #${issue.number} (PR #${integrationRes.prNumber})`);
        } else {
          this.dashboard.log(`Integration failed for Issue #${issue.number}: ${integrationRes.error}`);
          // Add comment and flag ready-for-human
          await this.gh.addComment(
            issue.number,
            `⚠️ Agent Auto-Pilot finished implementation, but automated integration/tests failed:\n\`\`\`\n${integrationRes.error}\n\`\`\``
          );
          await this.gh.editIssueLabels(issue.number, {
            add: [this.config.labels.readyForHuman],
            remove: [this.config.labels.readyForAgent],
          });
        }
      }
    } catch (err: any) {
      this.dashboard.log(`Task #${issue.number} failed: ${err.message}`);
      try {
        await this.gh.addComment(
          issue.number,
          `❌ Agent Auto-Pilot task failed with error:\n\`\`\`\n${err.message}\n\`\`\``
        );
        await this.gh.editIssueLabels(issue.number, {
          add: [this.config.labels.readyForHuman],
          remove: [this.config.labels.readyForAgent],
        });
      } catch {
        // Best effort
      }
    }
  }

  public getDAG(): IssueDAG {
    return this.dag;
  }
}
