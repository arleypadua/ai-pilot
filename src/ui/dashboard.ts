import Table from 'cli-table3';
import pc from 'picocolors';
import type { AutoPilotConfig, TaskStatus } from '../types/index.js';
import type { WorktreeInfo } from '../worktree/manager.js';
import type { QuotaStatus } from '../quota/monitor.js';
import type { IssueDAG } from '../github/dag.js';

export interface ActiveWorker {
  issueNumber: number;
  title: string;
  branchName: string;
  status: TaskStatus;
  startedAt: Date;
  lastOutput?: string;
  runnerName?: string;
}

export class Dashboard {
  private config: AutoPilotConfig;
  private logs: string[] = [];
  private activeWorkers: Map<number, ActiveWorker> = new Map();

  constructor(config: AutoPilotConfig) {
    this.config = config;
  }

  public log(message: string): void {
    const time = new Date().toLocaleTimeString();
    this.logs.push(`[${time}] ${message}`);
    if (this.logs.length > 200) {
      this.logs.shift();
    }
  }

  public clearLogs(): void {
    this.logs = [];
  }

  public updateWorker(worker: ActiveWorker): void {
    this.activeWorkers.set(worker.issueNumber, worker);
  }

  public upsertWorker(worker: ActiveWorker): void {
    this.activeWorkers.set(worker.issueNumber, worker);
  }

  public removeWorker(issueNumber: number): void {
    this.activeWorkers.delete(issueNumber);
  }

  public getActiveWorkers(): Map<number, ActiveWorker> {
    return this.activeWorkers;
  }

  public getLogs(): string[] {
    return [...this.logs];
  }

  private formatDuration(startedAt: Date): string {
    const sec = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  }

  public render(dag: IssueDAG, quotaStatus: QuotaStatus, existingWorktrees: WorktreeInfo[] = []): void {
    // Clear screen
    console.clear();

    const targetSpecs = dag.getTargetSpecs();
    let specContext = '';
    if (targetSpecs.length === 1) {
      specContext = ` | Scoped Spec: #${targetSpecs[0]}`;
    } else if (targetSpecs.length > 1) {
      specContext = ` | Scoped Specs: ${targetSpecs.map((s) => `#${s}`).join(', ')}`;
    }
    const repoContext = this.config.repository ? ` | Repo: ${this.config.repository}` : '';

    // Header Banner
    console.log(
      pc.bold(pc.bgCyan(pc.black(' ⚡ AGENT AUTO-PILOT '))) +
        pc.cyan(repoContext + specContext + ` | Default Runner: ${this.config.runner} | `) +
        `Concurrency: ${this.activeWorkers.size}/${this.config.maxConcurrency}`
    );

    // Quota Status Banner & Live Usage Telemetry from Claude / AGY CLI
    if (quotaStatus.isPaused && quotaStatus.resetAt) {
      const remainingMs = Math.max(0, quotaStatus.resetAt.getTime() - Date.now());
      const remainingMins = Math.ceil(remainingMs / (60 * 1000));
      console.log(
        pc.bgRed(pc.white(pc.bold(` ⏳ ${quotaStatus.pausedRunner ? quotaStatus.pausedRunner.toUpperCase() + ' ' : ''}5-HOUR QUOTA PAUSED `))) +
          pc.red(` Resumes at ${quotaStatus.resetAt.toLocaleTimeString()} (~${remainingMins} min remaining)`)
      );
    }

    if (quotaStatus.runnerUsage && Object.keys(quotaStatus.runnerUsage).length > 0) {
      for (const rUsage of Object.values(quotaStatus.runnerUsage)) {
        const header = pc.bold(pc.cyan(`● ${rUsage.displayName}:`));
        const bucketStrs = rUsage.buckets.map((b) => {
          const barLen = 10;
          const filled = Math.min(barLen, Math.round((b.usedPercentage / 100) * barLen));
          const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barLen - filled));
          const color = b.usedPercentage >= 95 ? pc.red : b.usedPercentage >= 80 ? pc.yellow : pc.green;
          const resetPart = b.resetText ? ` (resets ${b.resetText})` : '';
          return color(`${b.name}: [${bar}] ${b.usedPercentage}% used${resetPart}`);
        });
        console.log(`${header} ${bucketStrs.join('  •  ')}`);
      }
    } else if (quotaStatus.liveUsage) {
      const live = quotaStatus.liveUsage;
      const sessPct = live.sessionUsedPercentage;
      const barLen = 12;

      const sessFilled = Math.min(barLen, Math.round((sessPct / 100) * barLen));
      const sessBar = '█'.repeat(sessFilled) + '░'.repeat(Math.max(0, barLen - sessFilled));
      const sessColor = sessPct >= 100 ? pc.red : sessPct >= 80 ? pc.yellow : pc.green;

      let sessLine = sessColor(`● 5h Session Quota: [${sessBar}] ${sessPct}% used`);
      if (live.sessionResetText) {
        sessLine += pc.gray(` · Resets ${live.sessionResetText}`);
      }
      console.log(sessLine);

      if (live.weekUsedPercentage !== undefined) {
        const weekPct = live.weekUsedPercentage;
        const weekFilled = Math.min(barLen, Math.round((weekPct / 100) * barLen));
        const weekBar = '█'.repeat(weekFilled) + '░'.repeat(Math.max(0, barLen - weekFilled));
        const weekColor = weekPct >= 90 ? pc.red : weekPct >= 70 ? pc.yellow : pc.cyan;

        let weekLine = weekColor(`● Weekly Quota:    [${weekBar}] ${weekPct}% used`);
        if (live.weekResetText) {
          weekLine += pc.gray(` · Resets ${live.weekResetText}`);
        }
        console.log(weekLine);
      }
    } else {
      console.log(pc.green('● Quota Status: Normal (headroom healthy)'));
    }
    console.log('');

    // 1. Active & WIP Worktrees Table
    const workerTable = new Table({
      head: [
        pc.cyan('Issue'),
        pc.cyan('Runner'),
        pc.cyan('Title'),
        pc.cyan('Branch'),
        pc.cyan('Status'),
        pc.cyan('Elapsed'),
      ],
      colWidths: [10, 10, 28, 24, 16, 12],
    });

    const renderedIssueNumbers = new Set<number>();

    // Add in-memory actively executing workers
    for (const worker of this.activeWorkers.values()) {
      renderedIssueNumbers.add(worker.issueNumber);
      let statusStr: string = worker.status;
      if (worker.status === 'running') statusStr = pc.blue('⚡ running');
      else if (worker.status === 'testing') statusStr = pc.magenta('🧪 testing');
      else if (worker.status === 'merging') statusStr = pc.yellow('🔀 merging');
      else if (worker.status === 'paused_quota') statusStr = pc.red('⏳ paused');

      workerTable.push([
        `#${worker.issueNumber}`,
        pc.cyan(worker.runnerName || this.config.runner),
        worker.title.slice(0, 26),
        worker.branchName.slice(0, 22),
        statusStr,
        this.formatDuration(worker.startedAt),
      ]);
    }

    // Add WIP / Paused worktrees on disk waiting to resume
    for (const wt of existingWorktrees) {
      if (wt.issueNumber && !renderedIssueNumbers.has(wt.issueNumber)) {
        const node = dag.getNode(wt.issueNumber);
        if (node && node.issue.state === 'OPEN') {
          renderedIssueNumbers.add(wt.issueNumber);
          const runnerName = node.runnerName || this.config.runner;
          const isRunnerPaused = quotaStatus.pausedRunners ? Boolean(quotaStatus.pausedRunners[runnerName]) : quotaStatus.isPaused;

          let statusStr = pc.cyan('⏳ waiting (WIP)');
          if (node.status === 'waiting_feedback') {
            statusStr = pc.magenta('👀 in review');
          } else if (node.status === 'blocked') {
            statusStr = pc.gray('⏳ blocked');
          } else if (isRunnerPaused) {
            statusStr = pc.yellow('⏳ paused (quota)');
          }

          workerTable.push([
            `#${wt.issueNumber}`,
            pc.cyan(node.runnerName || this.config.runner),
            node.issue.title.slice(0, 26),
            wt.branch.slice(0, 22),
            statusStr,
            pc.gray('preserves WIP'),
          ]);
        }
      }
    }

    if (renderedIssueNumbers.size === 0) {
      workerTable.push([
        { colSpan: 6, content: pc.gray('No active agent workers running (Idle)') },
      ]);
    }

    console.log(pc.bold('Active & Paused Agent Worktrees:'));
    console.log(workerTable.toString());
    console.log('');

    // 2. Ready & Blocked Issues Summary
    const ready = dag.getReadyNodes();
    const blocked = dag.getBlockedNodes();
    const feedback = dag.getWaitingFeedbackNodes();

    const queueTable = new Table({
      head: [pc.cyan('Status'), pc.cyan('Count'), pc.cyan('Issues')],
      colWidths: [20, 8, 50],
    });

    queueTable.push(
      [
        pc.green('Ready for Agent'),
        ready.length.toString(),
        ready.map((n) => `#${n.issue.number}`).join(', ') || pc.gray('None'),
      ],
      [
        pc.yellow('Waiting Feedback'),
        feedback.length.toString(),
        feedback.map((n) => `#${n.issue.number}`).join(', ') || pc.gray('None'),
      ],
      [
        pc.gray('Blocked by Deps'),
        blocked.length.toString(),
        blocked.map((n) => `#${n.issue.number} (blocked by ${n.blockers.join(', ')})`).join(', ') || pc.gray('None'),
      ]
    );

    console.log(pc.bold('Issue DAG Queue:'));
    console.log(queueTable.toString());
    console.log('');

    // 3. Activity Logs
    console.log(pc.bold('Activity Log:'));
    if (this.logs.length === 0) {
      console.log(pc.gray('  Waiting for events...'));
    } else {
      for (const line of this.logs) {
        console.log(`  ${line}`);
      }
    }
  }
}
