import fs from 'node:fs';
import path from 'node:path';
import type { TaskStatus } from '../types/index.js';

export interface TaskSessionMetadata {
  issueNumber: number;
  title: string;
  url?: string;
  branchName: string;
  worktreePath: string;
  runner: string;
  status: TaskStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  pid?: number;
  error?: string;
  prUrl?: string;
  prNumber?: number;
  timeline: Array<{
    timestamp: string;
    stage: string;
    message?: string;
  }>;
}

export interface AutoPilotRuntimeState {
  daemonStatus: 'idle' | 'running' | 'paused_quota';
  lastPollAt?: string;
  quotaPausedUntil?: string;
  activeTasks: Record<number, TaskSessionMetadata>;
  recentHistory: Array<{
    issueNumber: number;
    title: string;
    status: 'completed' | 'failed' | 'waiting_feedback';
    prUrl?: string;
    completedAt: string;
  }>;
}

export class StateManager {
  private baseDir: string;
  private autopilotDir: string;
  private stateFilePath: string;
  private sessionsDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.autopilotDir = path.resolve(baseDir, '.autopilot');
    this.stateFilePath = path.resolve(this.autopilotDir, 'state.json');
    this.sessionsDir = path.resolve(this.autopilotDir, 'sessions');

    this.ensureDirectories();
  }

  public ensureDirectories(): void {
    if (!fs.existsSync(this.autopilotDir)) {
      fs.mkdirSync(this.autopilotDir, { recursive: true });
    }
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  public getSessionDir(issueNumber: number): string {
    const dir = path.resolve(this.sessionsDir, `issue-${issueNumber}`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public getState(): AutoPilotRuntimeState {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const raw = fs.readFileSync(this.stateFilePath, 'utf8');
        return JSON.parse(raw);
      } catch {
        // Fallback if corrupted
      }
    }
    return {
      daemonStatus: 'idle',
      activeTasks: {},
      recentHistory: [],
    };
  }

  public saveState(state: AutoPilotRuntimeState): void {
    try {
      this.ensureDirectories();
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
    } catch {
      // Best effort
    }
  }

  public updateDaemonStatus(status: 'idle' | 'running' | 'paused_quota', quotaPausedUntil?: string): void {
    const state = this.getState();
    state.daemonStatus = status;
    state.lastPollAt = new Date().toISOString();
    state.quotaPausedUntil = quotaPausedUntil;
    this.saveState(state);
  }

  public startTaskSession(metadata: {
    issueNumber: number;
    title: string;
    url?: string;
    branchName: string;
    worktreePath: string;
    runner: string;
    pid?: number;
  }): TaskSessionMetadata {
    const sessionDir = this.getSessionDir(metadata.issueNumber);
    const now = new Date().toISOString();

    const session: TaskSessionMetadata = {
      ...metadata,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      timeline: [
        {
          timestamp: now,
          stage: 'DISPATCHED',
          message: `Allocated worktree at ${metadata.worktreePath}`,
        },
      ],
    };

    // Save session.json
    fs.writeFileSync(
      path.resolve(sessionDir, 'session.json'),
      JSON.stringify(session, null, 2),
      'utf8'
    );

    // Initialize or clear stdout.log and stderr.log
    fs.writeFileSync(path.resolve(sessionDir, 'stdout.log'), `--- Task #${metadata.issueNumber} Started at ${now} ---\n`, 'utf8');
    fs.writeFileSync(path.resolve(sessionDir, 'stderr.log'), '', 'utf8');

    // Update global state
    const state = this.getState();
    state.activeTasks[metadata.issueNumber] = session;
    this.saveState(state);

    return session;
  }

  public appendTaskLog(issueNumber: number, type: 'stdout' | 'stderr', chunk: string): void {
    try {
      const sessionDir = this.getSessionDir(issueNumber);
      const logFile = path.resolve(sessionDir, type === 'stdout' ? 'stdout.log' : 'stderr.log');
      fs.appendFileSync(logFile, chunk, 'utf8');
    } catch {
      // Best effort
    }
  }

  public recordTaskStage(issueNumber: number, stage: string, status?: TaskStatus, message?: string): void {
    const sessionDir = this.getSessionDir(issueNumber);
    const sessionFile = path.resolve(sessionDir, 'session.json');
    const now = new Date().toISOString();

    let session: TaskSessionMetadata;
    if (fs.existsSync(sessionFile)) {
      session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    } else {
      return;
    }

    if (status) session.status = status;
    session.updatedAt = now;
    session.timeline.push({ timestamp: now, stage, message });

    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2), 'utf8');

    const state = this.getState();
    if (state.activeTasks[issueNumber]) {
      state.activeTasks[issueNumber] = session;
      this.saveState(state);
    }
  }

  public finishTaskSession(
    issueNumber: number,
    finalStatus: 'completed' | 'failed' | 'waiting_feedback',
    details?: { prUrl?: string; prNumber?: number; error?: string }
  ): void {
    const sessionDir = this.getSessionDir(issueNumber);
    const sessionFile = path.resolve(sessionDir, 'session.json');
    const now = new Date().toISOString();

    let session: TaskSessionMetadata | undefined = undefined;
    if (fs.existsSync(sessionFile)) {
      session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      if (session) {
        session.status = finalStatus;
        session.completedAt = now;
        session.updatedAt = now;
        if (details?.prUrl) session.prUrl = details.prUrl;
        if (details?.prNumber) session.prNumber = details.prNumber;
        if (details?.error) session.error = details.error;

        session.timeline.push({
          timestamp: now,
          stage: finalStatus.toUpperCase(),
          message: details?.error || (details?.prUrl ? `PR: ${details.prUrl}` : undefined),
        });

        fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2), 'utf8');
      }
    }

    const state = this.getState();
    delete state.activeTasks[issueNumber];

    if (session) {
      state.recentHistory.unshift({
        issueNumber,
        title: session.title,
        status: finalStatus,
        prUrl: details?.prUrl,
        completedAt: now,
      });
      if (state.recentHistory.length > 20) {
        state.recentHistory.pop();
      }
    }

    this.saveState(state);
  }

  public getSession(issueNumber: number): { metadata?: TaskSessionMetadata; stdout?: string; stderr?: string } {
    const sessionDir = path.resolve(this.sessionsDir, `issue-${issueNumber}`);
    if (!fs.existsSync(sessionDir)) return {};

    const sessionFile = path.resolve(sessionDir, 'session.json');
    const stdoutFile = path.resolve(sessionDir, 'stdout.log');
    const stderrFile = path.resolve(sessionDir, 'stderr.log');

    const metadata = fs.existsSync(sessionFile)
      ? JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
      : undefined;

    const stdout = fs.existsSync(stdoutFile) ? fs.readFileSync(stdoutFile, 'utf8') : undefined;
    const stderr = fs.existsSync(stderrFile) ? fs.readFileSync(stderrFile, 'utf8') : undefined;

    return { metadata, stdout, stderr };
  }
}
