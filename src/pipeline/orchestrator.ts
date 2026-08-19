import type { AutoPilotConfig, DAGNode } from '../types/index.js';
import { GitHubClient } from '../github/client.js';
import { IssueDAG } from '../github/dag.js';
import { WorktreeManager } from '../worktree/manager.js';
import { QuotaMonitor } from '../quota/monitor.js';
import { RunnerRegistry } from '../runners/registry.js';
import { Integrator } from './integrator.js';
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
  private integrator: Integrator;
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
    this.integrator = new Integrator(config, this.gh, this.worktreeMgr);
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
    this.stateMgr.updateDaemonStatus('idle');
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
        const latestComment = node.issue.comments?.[node.issue.comments.length - 1]?.body;
        this.lastKnownFeedbackQuestions.set(node.issue.number, latestComment || 'Waiting for human input');
        Notifier.notifyTaskNeedsFeedback(node.issue.number, node.issue.title, latestComment);
        this.dashboard.log(`Issue #${node.issue.number} flagged for human feedback.`);
      }
    }

    // 5. Check if scoped Spec is completely finished
    if (this.config.targetSpec) {
      const specNumber = this.config.targetSpec;
      const specCheck = this.dag.isSpecComplete(specNumber);

      if (specCheck.isComplete && this.activeTaskNumbers.size === 0) {
        if (!this.notifiedSpecCompletions.has(specNumber)) {
          this.notifiedSpecCompletions.add(specNumber);

          this.dashboard.log(
            `🎉 Spec #${specNumber} is complete! All ${specCheck.totalTickets} child tickets are merged. Waiting for developer review and closure.`
          );

          Notifier.notifyDesktop({
            title: `Auto-Pilot: Spec #${specNumber} Complete`,
            message: `All ${specCheck.totalTickets} child tickets merged. Waiting for developer closure.`,
          });

          try {
            await this.gh.addComment(
              specNumber,
              `🎉 **Spec Complete**: All ${specCheck.totalTickets} child tickets for this spec have been implemented and merged.\n\nWaiting for developer review and closure.`
            );
            await this.gh.editIssueLabels(specNumber, {
              add: [this.config.labels.readyForHuman],
              remove: [this.config.labels.readyForAgent],
            });
          } catch {
            // Best effort
          }
        }
        return;
      }
    }

    // 6. Identify ready candidates
    const readyNodes = this.dag.getReadyNodes();

    for (const node of readyNodes) {
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

      // Start Session in State Manager
      this.stateMgr.startTaskSession({
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

      // 2. Check user feedback
      let userFeedback: string | undefined = undefined;
      if (isContinuation && issue.comments && issue.comments.length > 0) {
        userFeedback = issue.comments[issue.comments.length - 1].body;
      }

      // 3. Run Agent
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
          onOutput: (chunk) => {
            this.stateMgr.appendTaskLog(issue.number, 'stdout', chunk);
          },
          onStderr: (chunk) => {
            this.stateMgr.appendTaskLog(issue.number, 'stderr', chunk);
          },
          onPid: (pid) => {
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

      // Check if runner or agent changed label to needs-info / ready-for-human
      const updatedIssue = await this.gh.viewIssue(issue.number);
      const hasFeedbackLabel = updatedIssue.labels.some((l) =>
        [this.config.labels.needsInfo, this.config.labels.readyForHuman].includes(l.name)
      );

      if (hasFeedbackLabel || runnerRes.status === 'NEEDS_INFO') {
        this.stateMgr.finishTaskSession(issue.number, 'waiting_feedback');
        this.dashboard.log(`Issue #${issue.number} parked awaiting developer feedback.`);
        return;
      }

      // 4. If Completed, run Integration & Merge Pipeline
      if (runnerRes.success || runnerRes.status === 'COMPLETED') {
        this.stateMgr.recordTaskStage(issue.number, 'INTEGRATING', 'testing', 'Running test suites & rebasing');
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
          this.stateMgr.finishTaskSession(issue.number, 'completed', {
            prUrl: integrationRes.prUrl,
            prNumber: integrationRes.prNumber,
          });
          this.dashboard.log(`Successfully merged & closed Issue #${issue.number} (PR #${integrationRes.prNumber})`);
        } else {
          this.stateMgr.finishTaskSession(issue.number, 'failed', {
            error: integrationRes.error,
          });
          this.dashboard.log(`Integration failed for Issue #${issue.number}: ${integrationRes.error}`);
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
      this.stateMgr.finishTaskSession(issue.number, 'failed', { error: err.message });
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
