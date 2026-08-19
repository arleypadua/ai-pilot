import type { AutoPilotConfig, DAGNode } from '../types/index.js';
import { GitHubClient } from '../github/client.js';
import { IssueDAG } from '../github/dag.js';
import { WorktreeManager } from '../worktree/manager.js';
import { QuotaMonitor } from '../quota/monitor.js';
import { RunnerRegistry } from '../runners/registry.js';
import { Notifier } from '../notifications/notifier.js';
import { Dashboard } from '../ui/dashboard.js';
import { StateManager } from '../state/manager.js';

export class Orchestrator {
  private config: AutoPilotConfig;
  private gh: GitHubClient;
  private dag: IssueDAG;
  private worktreeMgr: WorktreeManager;
  private quotaMonitor: QuotaMonitor;
  private runners: RunnerRegistry;
  private dashboard: Dashboard;
  private stateMgr: StateManager;

  private isRunning: boolean = false;
  private pollTimer?: NodeJS.Timeout;
  private activeTaskNumbers: Set<number> = new Set();
  private lastKnownFeedbackQuestions: Map<number, string> = new Map();
  private notifiedSpecCompletions: Set<number> = new Set();

  constructor(config: AutoPilotConfig) {
    this.config = config;
    this.gh = new GitHubClient({ repository: config.repository });
    this.dag = new IssueDAG(config);
    this.worktreeMgr = new WorktreeManager();
    this.quotaMonitor = new QuotaMonitor();
    this.runners = new RunnerRegistry(this.quotaMonitor);
    this.dashboard = new Dashboard(config);
    this.stateMgr = new StateManager();

    // Setup quota event listeners
    this.quotaMonitor.on('quota_paused', ({ resetAt, waitMs }) => {
      const waitMinutes = Math.ceil(waitMs / (60 * 1000));
      this.stateMgr.updateDaemonStatus('paused_quota', resetAt.toISOString());
      Notifier.notifyQuotaPaused(resetAt, waitMinutes);
      this.dashboard.log(`5h Quota limit hit. Suspended workers until ${resetAt.toLocaleTimeString()}`);
    });

    this.quotaMonitor.on('quota_resumed', () => {
      this.stateMgr.updateDaemonStatus('running');
      this.dashboard.log('Quota reset window reached. Resuming workers.');
    });
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    this.stateMgr.updateDaemonStatus('running');
    this.dashboard.log('Agent Auto-Pilot started.');

    // Check GitHub Auth
    const isAuthed = await this.gh.checkAuth();
    if (!isAuthed) {
      throw new Error('gh CLI is not authenticated. Please run `gh auth login` first.');
    }

    this.stateMgr.updateDaemonStatus('running');

    // Initial fetch of Claude live usage from /usage
    await this.quotaMonitor.fetchLiveUsage(true);

    // Initial tick
    await this.tick();

    // Setup polling
    this.pollTimer = setInterval(async () => {
      try {
        await this.tick();
      } catch (err: any) {
        this.dashboard.log(`Polling tick error: ${err.message}`);
      }
    }, this.config.pollIntervalSeconds * 1000);
  }

  public stop(): void {
    this.isRunning = false;
    this.stateMgr.updateDaemonStatus('idle');
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.dashboard.log('Agent Auto-Pilot stopped.');
  }

  public async tick(): Promise<void> {
    // 0. Fetch live Claude usage telemetry (/usage)
    await this.quotaMonitor.fetchLiveUsage();

    // 1. Fetch latest issues
    const issues = await this.gh.fetchIssues();
    this.dag.build(issues);

    // 2. Refresh UI Dashboard
    const activeWorktrees = await this.worktreeMgr.listActiveWorktrees();
    this.dashboard.render(this.dag, this.quotaMonitor.getStatus(), activeWorktrees);

    // 3. If Quota is paused, do not dispatch new tasks
    if (this.quotaMonitor.getStatus().isPaused) {
      return;
    }

    // 4. Check for Spec Completion
    if (this.config.targetSpec) {
      const specNum = this.config.targetSpec;
      const specStatus = this.dag.isSpecComplete(specNum);

      if (specStatus.isComplete && !this.notifiedSpecCompletions.has(specNum)) {
        this.notifiedSpecCompletions.add(specNum);
        this.dashboard.log(`Spec #${specNum} is COMPLETE! All child tickets are merged.`);
        Notifier.notifySpecComplete(specNum, `Spec #${specNum} is complete`);

        try {
          await this.gh.addComment(
            specNum,
            `🎉 **Spec Complete**: All child tickets for this spec have been implemented and closed.\n\nWaiting for developer review and closure.`
          );
          await this.gh.editIssueLabels(specNum, {
            add: [this.config.labels.readyForHuman],
            remove: [this.config.labels.readyForAgent],
          });
        } catch {
          // Best effort
        }
      }
    }

    // 5. Check for newly ready feedback tasks
    const waitingNodes = this.dag.getWaitingFeedbackNodes();
    for (const node of waitingNodes) {
      const issue = node.issue;
      const lastComment = issue.comments && issue.comments.length > 0 ? issue.comments[issue.comments.length - 1].body : '';
      const prevComment = this.lastKnownFeedbackQuestions.get(issue.number);

      if (lastComment && lastComment !== prevComment) {
        this.lastKnownFeedbackQuestions.set(issue.number, lastComment);
        Notifier.notifyNeedsFeedback(issue.number, issue.title, lastComment);
        this.dashboard.log(`Notification sent for Issue #${issue.number} (needs info)`);
      }
    }

    // 6. Schedule Ready Tasks up to maxConcurrency (with Proactive Quota Pacing)
    const quotaStatus = this.quotaMonitor.getStatus(
      this.config.quota.utilizationThreshold,
      this.config.quota.tokenCeiling
    );
    if (quotaStatus.rollingStats?.isApproachingLimit) {
      const stats = quotaStatus.rollingStats;
      const rollOffTimeStr = stats.nextRollOffAt ? stats.nextRollOffAt.toLocaleTimeString() : 'soon';
      this.dashboard.log(
        `⏳ Pacing Quota: 5h window at ${Math.round(stats.utilization * 100)}% (${Math.round(stats.totalOutputTokens / 1000)}k/${Math.round(stats.estimatedCeiling / 1000)}k tokens). Waiting for roll-off at ${rollOffTimeStr}.`
      );
      return;
    }

    const readyNodes = this.dag.getReadyNodes();
    const availableSlots = this.config.maxConcurrency - this.activeTaskNumbers.size;

    if (availableSlots <= 0 || readyNodes.length === 0) {
      return;
    }

    const tasksToDispatch = readyNodes
      .filter((n) => !this.activeTaskNumbers.has(n.issue.number))
      .slice(0, availableSlots);

    for (const node of tasksToDispatch) {
      this.activeTaskNumbers.add(node.issue.number);
      // Run asynchronously in background
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

      // Start Session in State Manager
      const session = this.stateMgr.startTaskSession({
        issueNumber: issue.number,
        title: issue.title,
        url: issue.url,
        branchName,
        worktreePath,
        runner: this.config.runner,
      });

      this.dashboard.updateWorker({
        issueNumber: issue.number,
        title: issue.title,
        branchName,
        status: 'running',
        startedAt: new Date(),
      });

      // 2. Post Start/Resume Comment to GitHub Issue
      const startComment = isContinuation
        ? `🔄 **Agent Auto-Pilot resumed work**\n\n- **Session ID**: \`${session.sessionId}\`\n- **Runner**: \`${this.config.runner}\` (/implement)\n- **Branch**: \`${branchName}\`\n- **Worktree**: \`${worktreePath}\`\n- **Resumed At**: \`${new Date().toUTCString()}\`\n\n*Continuing implementation with latest feedback from comments.*`
        : `🤖 **Agent Auto-Pilot started implementation**\n\n- **Session ID**: \`${session.sessionId}\`\n- **Runner**: \`${this.config.runner}\` (/implement)\n- **Branch**: \`${branchName}\`\n- **Worktree**: \`${worktreePath}\`\n- **Base Branch**: \`${this.config.baseBranch}\`\n- **Started At**: \`${new Date().toUTCString()}\`\n\n*Delegating task to \`${this.config.runner}\` (/implement).*`;

      try {
        await this.gh.addComment(issue.number, startComment);
      } catch {
        // Comment failure is non-fatal
      }

      // 3. Check user feedback for continuation (filtering out autopilot bot comments)
      let userFeedback: string | undefined = undefined;
      if (isContinuation && issue.comments && issue.comments.length > 0) {
        const humanComments = issue.comments.filter(
          (c) =>
            !c.body.startsWith('🤖 **Agent Auto-Pilot') &&
            !c.body.startsWith('🔄 **Agent Auto-Pilot') &&
            !c.body.startsWith('🎉 **Spec Complete') &&
            !c.body.startsWith('⚠️ Agent Auto-Pilot') &&
            !c.body.startsWith('❌ Agent Auto-Pilot')
        );
        if (humanComments.length > 0) {
          userFeedback = humanComments[humanComments.length - 1].body;
        }
      }

      // 4. Run Agent (/implement)
      const runner = this.runners.get(this.config.runner);
      this.stateMgr.recordTaskStage(issue.number, 'AGENT_RUNNING', 'running', `Invoking ${this.config.runner} /implement`);

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
          issueNumber: issue.number,
          onOutput: (chunk: string) => {
            this.stateMgr.appendTaskLog(issue.number, 'stdout', chunk);
          },
          onStderr: (chunk: string) => {
            this.stateMgr.appendTaskLog(issue.number, 'stderr', chunk);
          },
          onPid: (pid: number) => {
            this.stateMgr.recordTaskStage(issue.number, 'PID_ASSIGNED', 'running', `Process PID: ${pid}`);
          },
        }
      );

      // Check if runner paused due to quota
      if (runnerRes.status === 'QUOTA_PAUSED') {
        this.stateMgr.recordTaskStage(issue.number, 'QUOTA_PAUSED', 'paused_quota', 'Paused due to 5h quota limits');
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

      // 5. Inspect issue state on GitHub after agent finishes
      const updatedIssue = await this.gh.viewIssue(issue.number);
      const hasFeedbackLabel = updatedIssue.labels.some((l) =>
        [this.config.labels.needsInfo, this.config.labels.readyForHuman].includes(l.name)
      );

      // Case A: Agent requested info from human
      if (hasFeedbackLabel || runnerRes.status === 'NEEDS_INFO') {
        this.stateMgr.finishTaskSession(issue.number, 'waiting_feedback');
        this.dashboard.log(`Issue #${issue.number} parked awaiting developer feedback.`);
        return;
      }

      // Case B: Agent completed and closed/merged the issue
      if (updatedIssue.state === 'CLOSED') {
        this.stateMgr.finishTaskSession(issue.number, 'completed');
        this.dashboard.log(`Issue #${issue.number} completed and closed.`);
        Notifier.notifyTaskMerged(issue.number, issue.title);

        if (this.config.cleanupWorktreeOnClose) {
          await this.worktreeMgr.cleanupWorktree(issue.number, issue.title, true);
        }
        return;
      }

      // Case C: Issue remains open
      if (runnerRes.success || runnerRes.status === 'COMPLETED') {
        this.dashboard.log(`Agent finished execution for Issue #${issue.number}.`);
      } else {
        this.stateMgr.finishTaskSession(issue.number, 'failed', { error: runnerRes.error });
        this.dashboard.log(`Agent exited with error on Issue #${issue.number}: ${runnerRes.error || 'Unknown'}`);
      }
    } catch (err: any) {
      this.stateMgr.finishTaskSession(issue.number, 'failed', { error: err.message });
      this.dashboard.log(`Task #${issue.number} error: ${err.message}`);
    }
  }

  public getDAG(): IssueDAG {
    return this.dag;
  }
}
