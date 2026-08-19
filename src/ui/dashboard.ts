import Table from 'cli-table3';
import pc from 'picocolors';
import type { AutoPilotConfig, TaskStatus } from '../types/index.js';
import type { QuotaStatus } from '../quota/monitor.js';
import type { IssueDAG } from '../github/dag.js';

export interface ActiveWorker {
  issueNumber: number;
  title: string;
  branchName: string;
  status: TaskStatus;
  startedAt: Date;
  lastOutput?: string;
}

export class Dashboard {
  private config: AutoPilotConfig;
  private logs: string[] = [];
  private activeWorkers: Map<number, ActiveWorker> = new Map();

  constructor(config: AutoPilotConfig) {
    this.config = config;
  }

  public log(message: string): void {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.logs.push(`[${time}] ${message}`);
    if (this.logs.length > 8) {
      this.logs.shift();
    }
  }

  public updateWorker(worker: ActiveWorker): void {
    this.activeWorkers.set(worker.issueNumber, worker);
  }

  public removeWorker(issueNumber: number): void {
    this.activeWorkers.delete(issueNumber);
  }

  private formatDuration(startedAt: Date): string {
    const sec = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  }

  public render(dag: IssueDAG, quotaStatus: QuotaStatus): void {
    // Clear screen
    process.stdout.write('\x1Bc');

    console.log(
      pc.bold(pc.cyan('⚡ AGENT AUTO-PILOT')) +
        pc.gray(' | ') +
        pc.bold(`Repo: ${this.config.repository || 'Local'}`) +
        (this.config.targetSpec ? pc.magenta(` | Scoped Spec: #${this.config.targetSpec}`) : '') +
        pc.gray(' | ') +
        pc.green(`Runner: ${this.config.runner} (/implement)`) +
        pc.gray(' | ') +
        `Concurrency: ${this.activeWorkers.size}/${this.config.maxConcurrency}`
    );

    // Quota Status Banner & Live Usage Telemetry from Claude CLI
    if (quotaStatus.isPaused && quotaStatus.resetAt) {
      const remainingMs = Math.max(0, quotaStatus.resetAt.getTime() - Date.now());
      const remainingMins = Math.ceil(remainingMs / (60 * 1000));
      console.log(
        pc.bgRed(pc.white(pc.bold(' ⏳ 5-HOUR QUOTA PAUSED '))) +
          pc.red(` Resumes at ${quotaStatus.resetAt.toLocaleTimeString()} (~${remainingMins} min remaining)`)
      );
    }

    if (quotaStatus.liveUsage) {
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
    } else if (quotaStatus.rollingStats) {
      const stats = quotaStatus.rollingStats;
      const pct = Math.round(stats.utilization * 100);
      const usedK = Math.round(stats.totalOutputTokens / 1000);
      const capK = Math.round(stats.estimatedCeiling / 1000);

      const barLen = 12;
      const filled = Math.min(barLen, Math.round((pct / 100) * barLen));
      const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barLen - filled));

      let meterColor = pc.green;
      if (pct >= 85) meterColor = pc.red;
      else if (pct >= 70) meterColor = pc.yellow;

      console.log(
        meterColor(`● 5h Rolling Quota: [${bar}] ${pct}% (${usedK}k / ${capK}k output tokens)`)
      );
    } else {
      console.log(pc.green('● Quota Status: Normal (5h window healthy)'));
    }
    console.log('');

    // 1. Active Workers Table
    const workerTable = new Table({
      head: [
        pc.cyan('Issue'),
        pc.cyan('Title'),
        pc.cyan('Branch'),
        pc.cyan('Status'),
        pc.cyan('Elapsed'),
      ],
      colWidths: [10, 32, 28, 16, 12],
    });

    if (this.activeWorkers.size === 0) {
      workerTable.push([
        { colSpan: 5, content: pc.gray('No active agent workers running (Idle)') },
      ]);
    } else {
      for (const worker of this.activeWorkers.values()) {
        let statusStr: string = worker.status;
        if (worker.status === 'running') statusStr = pc.blue('⚡ running');
        else if (worker.status === 'testing') statusStr = pc.magenta('🧪 testing');
        else if (worker.status === 'merging') statusStr = pc.yellow('🔀 merging');
        else if (worker.status === 'paused_quota') statusStr = pc.red('⏳ paused');

        workerTable.push([
          `#${worker.issueNumber}`,
          worker.title.slice(0, 30),
          worker.branchName.slice(0, 26),
          statusStr,
          this.formatDuration(worker.startedAt),
        ]);
      }
    }

    console.log(pc.bold('Active Agent Worktrees:'));
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
