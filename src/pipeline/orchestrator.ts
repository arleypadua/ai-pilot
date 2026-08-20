import { execa } from 'execa';
import type { AutoPilotConfig, DAGNode } from '../types/index.js';
import { GitHubClient } from '../github/client.js';
import { IssueDAG } from '../github/dag.js';
import { WorktreeManager } from '../worktree/manager.js';
import { QuotaMonitor } from '../quota/monitor.js';
import { RunnerRegistry } from '../runners/registry.js';
import { RunnerFacade } from '../runners/facade.js';
import { Notifier } from '../notifications/notifier.js';
import { Dashboard } from '../ui/dashboard.js';
import { StateManager } from '../state/manager.js';
import { AgentEventBus } from '../events/bus.js';

export class Orchestrator {
  private config: AutoPilotConfig;
  private gh: GitHubClient;
  private dag: IssueDAG;
  private worktreeMgr: WorktreeManager;
  private quotaMonitor: QuotaMonitor;
  private runnerFacade: RunnerFacade;
  private dashboard: Dashboard;
  private stateMgr: StateManager;
  private eventBus = AgentEventBus.getInstance();

  private isRunning: boolean = false;
  private isInteractive: boolean = false;
  private pollTimer?: NodeJS.Timeout;
  private activeTaskNumbers: Set<number> = new Set();
  private lastKnownFeedbackQuestions: Map<number, string> = new Map();
  private notifiedSpecCompletions: Set<number> = new Set();
  private tickListeners: Array<() => void> = [];
  private latestActiveWorktrees: Array<{ path: string; branch: string; issueNumber?: number }> = [];
  private isSessionStarted: boolean = true;

  constructor(config: AutoPilotConfig) {
    this.config = config;
    this.gh = new GitHubClient({ repository: config.repository });
    this.dag = new IssueDAG(config);
    this.worktreeMgr = new WorktreeManager();
    this.quotaMonitor = new QuotaMonitor();
    this.runnerFacade = new RunnerFacade({
      quotaMonitor: this.quotaMonitor,
      defaultRunner: config.runner,
      runnerConfig: config.runnerConfig,
    });
    this.dashboard = new Dashboard(config);
    this.stateMgr = new StateManager();

    // Auto-starts by default (either scoped to specs or resolving to any unblocked task)
    this.isSessionStarted = true;

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

  public setInteractive(interactive: boolean): void {
    this.isInteractive = interactive;
  }

  public onTick(listener: () => void): () => void {
    this.tickListeners.push(listener);
    return () => {
      this.tickListeners = this.tickListeners.filter((l) => l !== listener);
    };
  }

  public isStarted(): boolean {
    return this.isSessionStarted;
  }

  public setTargetSpecs(specs: number[]): void {
    this.config.targetSpecs = specs;
    delete this.config.targetSpec;
    this.dag.setTargetSpecs(specs);
    this.dashboard.log(
      specs.length > 0
        ? `Target scope updated to Spec(s): ${specs.map((s) => `#${s}`).join(', ')}`
        : 'Target scope updated to any unblocked task (all specs).'
    );
    this.tick().catch(() => {});
  }

  public startSession(specs?: number[]): { success: boolean; message: string } {
    if (specs !== undefined) {
      this.setTargetSpecs(specs);
    }
    this.isSessionStarted = true;
    this.stateMgr.updateDaemonStatus('running');
    return { success: true, message: 'Target spec scope updated successfully.' };
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    this.stateMgr.updateDaemonStatus('running');

    const targetSpecs = this.dag.getTargetSpecs();
    if (targetSpecs.length > 0) {
      this.dashboard.log(`Agent Auto-Pilot started (scoped to Spec(s): ${targetSpecs.map((s) => `#${s}`).join(', ')})`);
    } else {
      this.dashboard.log('Agent Auto-Pilot started (resolving across any unblocked tasks).');
    }

    // Check GitHub Auth
    const isAuthed = await this.gh.checkAuth();
    if (!isAuthed) {
      throw new Error('gh CLI is not authenticated. Please run `gh auth login` first.');
    }

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

    // 2. Refresh UI Dashboard (only clear/render in non-interactive mode)
    this.latestActiveWorktrees = await this.worktreeMgr.listActiveWorktrees();
    const activeWorktrees = this.latestActiveWorktrees;
    if (!this.isInteractive) {
      this.dashboard.render(this.dag, this.quotaMonitor.getStatus(), activeWorktrees);
    }

    // Notify tick listeners (for React Ink UI)
    for (const listener of this.tickListeners) {
      try {
        listener();
      } catch {}
    }

    // 3. If session not started yet, do not dispatch new tasks
    if (!this.isSessionStarted) {
      return;
    }

    // 4. Check for Spec Completion
    const targetSpecs = this.dag.getTargetSpecs();
    const specsToCheck = targetSpecs.length > 0
      ? targetSpecs
      : this.dag.getAllNodes().filter((n) => n.kind === 'spec' && n.issue.state === 'OPEN').map((n) => n.issue.number);

    for (const specNum of specsToCheck) {
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

    // 5. Prune completed/closed target specs from the active target scope
    const { removed: prunedSpecs, remaining: remainingSpecs } = this.dag.pruneCompletedTargetSpecs();
    for (const specNum of prunedSpecs) {
      this.dashboard.log(`Spec #${specNum} is completed/closed. Removed from target scope.`);
    }
    if (prunedSpecs.length > 0 && remainingSpecs.length === 0) {
      this.dashboard.log('All scoped specs have completed. Target scope updated to any unblocked task (all specs).');
    }

    // 6. Check for newly ready feedback tasks
    const waitingNodes = this.dag.getWaitingFeedbackNodes();
    for (const node of waitingNodes) {
      const issue = node.issue;
      const questionComments = issue.comments?.filter((c) => c.body.startsWith('❓ **Agent Question')) || [];
      const rawQuestion = questionComments.length > 0
        ? questionComments[questionComments.length - 1].body.replace(/^❓ \*\*Agent Question\*\*:\s*/, '')
        : (issue.comments && issue.comments.length > 0 ? issue.comments[issue.comments.length - 1].body : '');

      const prevComment = this.lastKnownFeedbackQuestions.get(issue.number);

      if (rawQuestion && rawQuestion !== prevComment) {
        this.lastKnownFeedbackQuestions.set(issue.number, rawQuestion);
        Notifier.notifyNeedsFeedback(issue.number, issue.title, rawQuestion);
        this.dashboard.log(`Notification sent for Issue #${issue.number} (needs info)`);
      }
    }

    // 6. Schedule Ready Tasks up to maxConcurrency (with Runner Quota Filtering)
    const readyNodes = this.dag.getReadyNodes();
    const availableSlots = this.config.maxConcurrency - this.activeTaskNumbers.size;

    if (availableSlots <= 0 || readyNodes.length === 0) {
      return;
    }

    // Filter tasks whose assigned runner is not currently paused due to quota
    const unpausedNodes = readyNodes.filter((node) => {
      const runnerName = this.runnerFacade.resolveRunnerName(node.issue, this.config.runner);
      return !this.quotaMonitor.isRunnerPaused(runnerName);
    });

    if (unpausedNodes.length === 0) {
      return;
    }

    const tasksToDispatch = unpausedNodes
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

  public async injectPrompt(issueNumber: number, prompt: string): Promise<{ success: boolean; message: string }> {
    this.eventBus.emitAgentEvent({
      issueNumber,
      type: 'prompt_injected',
      summary: `Prompt injected by developer: "${prompt}"`,
      detail: { prompt },
    });

    if (this.activeTaskNumbers.has(issueNumber)) {
      await this.runnerFacade.injectPrompt(issueNumber, prompt);
      return {
        success: true,
        message: `Injected prompt for active task #${issueNumber}. Waiting for tool call to finish before safe resume.`,
      };
    }

    // If task is not actively running, dispatch it directly with the prompt as user feedback
    const node = this.dag.getNode(issueNumber);
    if (node) {
      this.activeTaskNumbers.add(issueNumber);
      this.executeTask(node, prompt).finally(() => {
        this.activeTaskNumbers.delete(issueNumber);
        this.dashboard.removeWorker(issueNumber);
      });
      return {
        success: true,
        message: `Resumed task #${issueNumber} with feedback: "${prompt.slice(0, 60)}"`,
      };
    }

    return {
      success: false,
      message: `Issue #${issueNumber} not found in current issue backlog.`,
    };
  }

  private async executeTask(node: DAGNode, overrideFeedback?: string): Promise<void> {
    const { issue } = node;
    const isContinuation = await this.worktreeMgr.worktreeExists(issue.number);
    const runnerName = this.runnerFacade.resolveRunnerName(issue, this.config.runner);

    this.dashboard.log(`Dispatching Issue #${issue.number} [${runnerName}]: ${issue.title} ${isContinuation ? '(resuming)' : ''}`);

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
        runner: runnerName,
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
        ? `🔄 **Agent Auto-Pilot resumed work**\n\n- **Session ID**: \`${session.sessionId}\`\n- **Runner**: \`${runnerName}\` (/implement)\n- **Branch**: \`${branchName}\`\n- **Worktree**: \`${worktreePath}\`\n- **Resumed At**: \`${new Date().toUTCString()}\`\n\n*Continuing implementation with latest feedback from comments.*`
        : `🤖 **Agent Auto-Pilot started implementation**\n\n- **Session ID**: \`${session.sessionId}\`\n- **Runner**: \`${runnerName}\` (/implement)\n- **Branch**: \`${branchName}\`\n- **Worktree**: \`${worktreePath}\`\n- **Base Branch**: \`${this.config.baseBranch}\`\n- **Started At**: \`${new Date().toUTCString()}\`\n\n*Delegating task to \`${runnerName}\` (/implement).*`;

      try {
        await this.gh.addComment(issue.number, startComment);
      } catch {
        // Comment failure is non-fatal
      }

      // 3. Check user feedback for continuation
      let userFeedback: string | undefined = overrideFeedback;
      if (!userFeedback && isContinuation && issue.comments && issue.comments.length > 0) {
        const isBotOrAgentComment = (body: string): boolean =>
          body.startsWith('🤖') ||
          body.startsWith('🔄') ||
          body.startsWith('🎉') ||
          body.startsWith('⚠️') ||
          body.startsWith('❌') ||
          body.startsWith('❓ **Agent Question');

        // Find the latest question asked by the agent (if any)
        const questionComments = issue.comments.filter((c) => c.body.startsWith('❓ **Agent Question'));
        const latestQuestion = questionComments.length > 0 ? questionComments[questionComments.length - 1] : undefined;
        const questionTime = latestQuestion ? new Date(latestQuestion.createdAt).getTime() : 0;

        const previousSession = this.stateMgr.getSession(issue.number);
        const lastProcessedCommentId = previousSession.metadata?.lastProcessedCommentId;

        // Filter to only new, unhandled human replies created after the latest question
        const newReplies = issue.comments.filter((c) => {
          if (isBotOrAgentComment(c.body)) return false;
          if (lastProcessedCommentId && c.id === lastProcessedCommentId) return false;
          if (latestQuestion && new Date(c.createdAt).getTime() <= questionTime) return false;
          return true;
        });

        if (newReplies.length > 0) {
          const latestReply = newReplies[newReplies.length - 1];
          userFeedback = latestReply.body;

          // Record processed comment ID in state
          this.stateMgr.recordProcessedComment(issue.number, latestReply.id);

          // Acknowledge developer feedback with 'EYES' reaction on GitHub
          await this.gh.addCommentReaction(latestReply.id, 'EYES');
        }
      }

      // 4. Run Agent via RunnerFacade
      this.stateMgr.recordTaskStage(issue.number, 'AGENT_RUNNING', 'running', `Invoking ${runnerName} /implement`);

      const runnerRes = await this.runnerFacade.run(
        {
          issue,
          kind: node.kind,
          worktreePath,
          branchName,
          baseBranch: this.config.baseBranch,
          isContinuation,
          userFeedback,
          extraPrompt: this.config.extraPrompt,
          runnerName,
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
        },
        this.config.runner
      );

      // Check if runner was interrupted to apply developer prompt
      if (runnerRes.status === 'INTERRUPTED_FOR_PROMPT') {
        const nextPrompt = runnerRes.injectedPrompt || userFeedback;
        this.dashboard.log(`Issue #${issue.number} interrupted by developer prompt. Re-executing session with feedback...`);
        this.stateMgr.recordTaskStage(issue.number, 'PROMPT_RESUMED', 'running', `Resuming with prompt: ${nextPrompt?.slice(0, 80)}`);
        return this.executeTask(node, nextPrompt);
      }

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
        node.status = 'waiting_feedback';
        node.issue.labels = updatedIssue.labels;
        this.stateMgr.finishTaskSession(issue.number, 'waiting_feedback');
        this.dashboard.log(`Issue #${issue.number} parked awaiting developer feedback.`);
        return;
      }

      // Case B: Agent completed and closed/merged the issue
      if (updatedIssue.state === 'CLOSED') {
        node.status = 'completed';
        node.issue.state = 'CLOSED';
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
        const pr = await this.gh.findPRForBranch(branchName);

        // Attempt automated merge if autoMerge is enabled and a PR was opened
        if (pr && pr.state === 'OPEN' && this.config.autoMerge) {
          try {
            this.dashboard.log(`Auto-merging PR #${pr.number} for Issue #${issue.number}...`);
            await this.gh.mergePR(pr.number, this.config.mergeMethod, true);
            await this.gh.closeIssue(issue.number, `Closed via automated merge of PR #${pr.number}`);
            this.stateMgr.finishTaskSession(issue.number, 'completed', { prUrl: pr.url, prNumber: pr.number });
            this.dashboard.log(`Issue #${issue.number} completed and merged via PR #${pr.number}.`);
            Notifier.notifyTaskMerged(issue.number, issue.title);

            if (this.config.cleanupWorktreeOnClose) {
              await this.worktreeMgr.cleanupWorktree(issue.number, issue.title, true);
            }
            return;
          } catch (mergeErr: any) {
            this.dashboard.log(`Auto-merge failed for PR #${pr.number}: ${mergeErr.message}. Transitioning to human review.`);
          }
        }

        // Transition issue to ready-for-human so it does not loop in ready DAG queue
        try {
          await this.gh.editIssueLabels(issue.number, {
            add: [this.config.labels.readyForHuman],
            remove: [this.config.labels.readyForAgent],
          });
          const prMsg = pr ? `\n\n- **Pull Request**: [#${pr.number}](${pr.url})` : '';
          await this.gh.addComment(
            issue.number,
            `👀 **Ready for Human Review**\n\nAgent completed execution without closing/merging.${prMsg}\n\n*Marked \`${this.config.labels.readyForHuman}\` for developer review and merge.*`
          );
        } catch {
          // Best effort
        }

        this.stateMgr.finishTaskSession(issue.number, 'waiting_feedback', {
          prUrl: pr?.url,
          prNumber: pr?.number,
        });
        this.dashboard.log(`Issue #${issue.number} marked ready-for-human (${pr ? `PR #${pr.number}` : 'unmerged'}).`);
        Notifier.notifyNeedsFeedback(issue.number, issue.title, pr ? `PR #${pr.number} ready for review` : 'Agent finished execution');
        return;
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

  public getQuotaMonitor(): QuotaMonitor {
    return this.quotaMonitor;
  }

  public getWorktreeManager(): WorktreeManager {
    return this.worktreeMgr;
  }

  public getDashboard(): Dashboard {
    return this.dashboard;
  }

  public getStateManager(): StateManager {
    return this.stateMgr;
  }

  public getActiveTaskNumbers(): Set<number> {
    return this.activeTaskNumbers;
  }

  public getConfig(): AutoPilotConfig {
    return this.config;
  }

  public getActiveWorktrees(): Array<{ path: string; branch: string; issueNumber?: number }> {
    return this.latestActiveWorktrees;
  }

  public getRunnerFacade(): RunnerFacade {
    return this.runnerFacade;
  }

  public getRunners(): RunnerRegistry {
    return this.runnerFacade.getRegistry();
  }

  public async pauseWorker(issueNumber: number): Promise<{ success: boolean; message: string }> {
    const paused = this.runnerFacade.pause(issueNumber);
    if (paused) {
      const worker = this.dashboard.getActiveWorkers().get(issueNumber);
      if (worker) {
        worker.status = 'paused_quota';
        this.dashboard.updateWorker(worker);
      }
      this.dashboard.log(`Paused worker for Issue #${issueNumber}`);
      this.eventBus.emitAgentEvent({
        issueNumber,
        type: 'info',
        summary: `⏸️ Worker paused by developer`,
      });
      return { success: true, message: `Paused worker for Issue #${issueNumber}` };
    }
    return { success: false, message: `Could not pause worker #${issueNumber} (no active runner process)` };
  }

  public async resumeWorker(issueNumber: number): Promise<{ success: boolean; message: string }> {
    const resumed = this.runnerFacade.resume(issueNumber);
    if (resumed) {
      const worker = this.dashboard.getActiveWorkers().get(issueNumber);
      if (worker) {
        worker.status = 'running';
        this.dashboard.updateWorker(worker);
      }
      this.dashboard.log(`Resumed worker for Issue #${issueNumber}`);
      this.eventBus.emitAgentEvent({
        issueNumber,
        type: 'info',
        summary: `▶️ Worker resumed by developer`,
      });
      return { success: true, message: `Resumed worker for Issue #${issueNumber}` };
    }
    return { success: false, message: `Could not resume worker #${issueNumber}` };
  }

  public async killAndWipeWorker(issueNumber: number): Promise<{ success: boolean; message: string }> {
    try {
      await this.runnerFacade.stop(issueNumber);
    } catch {}

    this.activeTaskNumbers.delete(issueNumber);
    this.dashboard.removeWorker(issueNumber);

    try {
      await this.worktreeMgr.cleanupWorktree(issueNumber, undefined, true);
    } catch {}

    this.stateMgr.deleteSession(issueNumber);

    this.dashboard.log(`Killed worker and wiped worktree for Issue #${issueNumber}`);
    this.eventBus.emitAgentEvent({
      issueNumber,
      type: 'info',
      summary: `🛑 Worker killed and worktree wiped by developer`,
    });

    this.tick().catch(() => {});
    return { success: true, message: `Killed worker and wiped worktree for Issue #${issueNumber}` };
  }

  public async openIssueInBrowser(issueNumber: number): Promise<{ success: boolean; message: string }> {
    try {
      await execa('gh', ['issue', 'view', String(issueNumber), '--web']);
      return { success: true, message: `Opened Issue #${issueNumber} in GitHub web browser` };
    } catch {
      if (this.config.repository) {
        const url = `https://github.com/${this.config.repository}/issues/${issueNumber}`;
        try {
          const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
          await execa(opener, [url]);
          return { success: true, message: `Opened Issue #${issueNumber} in browser` };
        } catch (err: any) {
          return { success: false, message: `Failed to open browser: ${err.message}` };
        }
      }
      return { success: false, message: `Could not open Issue #${issueNumber}` };
    }
  }
}
