import Table from 'cli-table3';
import pc from 'picocolors';
import type { AutoPilotConfig, DAGNode, TaskStatus } from '../types/index.js';
import type { QuotaStatus } from '../quota/monitor.js';

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

  public render(dagNodes: DAGNode[], quotaStatus: QuotaStatus): void {
    // Clear screen
    process.stdout.write('\x1Bc');

    console.log(
      pc.bold(pc.cyan('⚡ AGENT AUTO-PILOT')) +
        pc.gray(' | ') +
        pc.bold(`Repo: ${this.config.repository || 'Local'}`) +
        pc.gray(' | ') +
        pc.green(`Runner: ${this.config.runner} (/implement)`) +
        pc.gray(' | ') +
        `Concurrency: ${this.activeWorkers.size}/${this.config.maxConcurrency}`
    );

    // Quota Status Banner
    if (quotaStatus.isPaused && quotaStatus.resetAt) {
      const remainingMs = Math.max(0, quotaStatus.resetAt.getTime() - Date.now());
      const remainingMins = Math.ceil(remainingMs / (60 * 1000));
      console.log(
        pc.bgRed(pc.white(pc.bold(' ⏳ 5-HOUR QUOTA PAUSED '))) +
          pc.red(` Resumes at ${quotaStatus.resetAt.toLocaleTimeString()} (~${remainingMins} min remaining)`)
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
    const ready = dagNodes.filter((n) => n.status === 'ready');
    const blocked = dagNodes.filter((n) => n.status === 'blocked');
    const feedback = dagNodes.filter((n) => n.status === 'waiting_feedback');

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
