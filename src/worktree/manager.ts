import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';

export interface WorktreeInfo {
  path: string;
  branch: string;
  issueNumber?: number;
}

export class WorktreeManager {
  private baseDir: string;
  private worktreesRoot: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.worktreesRoot = path.resolve(baseDir, '.autopilot', 'worktrees');
  }

  public getWorktreesRoot(): string {
    return this.worktreesRoot;
  }

  private sanitizeSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
  }

  public getBranchName(issueNumber: number, title: string): string {
    const slug = this.sanitizeSlug(title);
    return `agent/issue-${issueNumber}-${slug}`;
  }

  public getWorktreePathForIssue(issueNumber: number, title?: string): string {
    if (title) {
      const slug = this.sanitizeSlug(title);
      return path.resolve(this.worktreesRoot, `issue-${issueNumber}-${slug}`);
    }

    // Try finding existing worktree matching issueNumber prefix
    if (fs.existsSync(this.worktreesRoot)) {
      const entries = fs.readdirSync(this.worktreesRoot);
      const match = entries.find((e) => e.startsWith(`issue-${issueNumber}`));
      if (match) {
        return path.resolve(this.worktreesRoot, match);
      }
    }

    return path.resolve(this.worktreesRoot, `issue-${issueNumber}`);
  }

  public async worktreeExists(issueNumber: number): Promise<boolean> {
    const worktreePath = this.getWorktreePathForIssue(issueNumber);
    return fs.existsSync(worktreePath);
  }

  public async createWorktree(
    issueNumber: number,
    title: string,
    baseBranch: string = 'main'
  ): Promise<{ worktreePath: string; branchName: string }> {
    const branchName = this.getBranchName(issueNumber, title);
    const worktreePath = this.getWorktreePathForIssue(issueNumber, title);

    if (fs.existsSync(worktreePath)) {
      return { worktreePath, branchName };
    }

    fs.mkdirSync(this.worktreesRoot, { recursive: true });

    // Fetch latest baseBranch
    try {
      await execa('git', ['fetch', 'origin', baseBranch], { cwd: this.baseDir });
    } catch {
      // Offline or local only branch
    }

    // Determine base ref (origin/baseBranch or local baseBranch)
    let startPoint = `origin/${baseBranch}`;
    try {
      await execa('git', ['rev-parse', '--verify', startPoint], { cwd: this.baseDir });
    } catch {
      startPoint = baseBranch;
    }

    // Check if branch already exists
    let branchExists = false;
    try {
      await execa('git', ['rev-parse', '--verify', branchName], { cwd: this.baseDir });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (branchExists) {
      await execa('git', ['worktree', 'add', worktreePath, branchName], { cwd: this.baseDir });
    } else {
      await execa('git', ['worktree', 'add', '-b', branchName, worktreePath, startPoint], {
        cwd: this.baseDir,
      });
    }

    return { worktreePath, branchName };
  }

  public async rebaseWorktree(
    worktreePath: string,
    baseBranch: string = 'main'
  ): Promise<{ success: boolean; hasConflicts: boolean; output: string }> {
    try {
      await execa('git', ['fetch', 'origin', baseBranch], { cwd: worktreePath });
    } catch {
      // Continue if offline
    }

    let upstream = `origin/${baseBranch}`;
    try {
      await execa('git', ['rev-parse', '--verify', upstream], { cwd: worktreePath });
    } catch {
      upstream = baseBranch;
    }

    try {
      const { stdout, stderr } = await execa('git', ['rebase', upstream], { cwd: worktreePath });
      return { success: true, hasConflicts: false, output: `${stdout}\n${stderr}` };
    } catch (err: any) {
      const output = `${err.stdout || ''}\n${err.stderr || ''}`;
      const hasConflicts = output.includes('CONFLICT') || output.includes('Failed to merge');
      return { success: false, hasConflicts, output };
    }
  }

  public async abortRebase(worktreePath: string): Promise<void> {
    try {
      await execa('git', ['rebase', '--abort'], { cwd: worktreePath });
    } catch {
      // Ignore if not in rebase
    }
  }

  public async runTests(
    worktreePath: string,
    testCommand: string
  ): Promise<{ success: boolean; output: string }> {
    const trimmed = testCommand?.trim();
    if (!trimmed || trimmed === 'none' || trimmed === 'skip') {
      return { success: true, output: 'Tests skipped by configuration.' };
    }

    let effectiveCommand = trimmed;

    // If default "npm test" is set, verify root project type
    if (effectiveCommand === 'npm test') {
      const hasPackageJson = fs.existsSync(path.join(worktreePath, 'package.json'));
      const hasCargoToml = fs.existsSync(path.join(worktreePath, 'Cargo.toml'));
      const hasPnpmWorkspace = fs.existsSync(path.join(worktreePath, 'pnpm-workspace.yaml'));

      if (!hasPackageJson) {
        if (hasCargoToml) {
          effectiveCommand = 'cargo test';
        } else if (hasPnpmWorkspace) {
          effectiveCommand = 'pnpm test';
        } else {
          return {
            success: true,
            output: 'No root package.json or Cargo.toml detected in worktree. Skipping default npm test.',
          };
        }
      }
    }

    try {
      const { stdout, stderr } = await execa({
        cwd: worktreePath,
        shell: true,
      })`${effectiveCommand}`;
      return { success: true, output: `${stdout}\n${stderr}` };
    } catch (err: any) {
      return { success: false, output: `${err.stdout || ''}\n${err.stderr || ''}\n${err.message}` };
    }
  }

  public async commitAll(worktreePath: string, message: string): Promise<boolean> {
    try {
      await execa('git', ['add', '-A'], { cwd: worktreePath });
      const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: worktreePath });
      if (!stdout.trim()) {
        return false; // No changes to commit
      }
      await execa('git', ['commit', '-m', message], { cwd: worktreePath });
      return true;
    } catch {
      return false;
    }
  }

  public async pushBranch(worktreePath: string, branchName: string, force: boolean = false): Promise<void> {
    const args = ['push', '-u', 'origin', branchName];
    if (force) {
      args.push('--force-with-lease');
    }
    await execa('git', args, { cwd: worktreePath });
  }

  public async cleanupWorktree(issueNumber: number, title?: string, deleteBranch: boolean = true): Promise<void> {
    const worktreePath = this.getWorktreePathForIssue(issueNumber, title);
    const branchName = title ? this.getBranchName(issueNumber, title) : undefined;

    if (fs.existsSync(worktreePath)) {
      try {
        await execa('git', ['worktree', 'remove', '--force', worktreePath], { cwd: this.baseDir });
      } catch {
        // Fallback: prune worktrees and delete directory
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
          await execa('git', ['worktree', 'prune'], { cwd: this.baseDir });
        } catch {
          // Best effort
        }
      }
    }

    if (deleteBranch) {
      try {
        // Find matching branch name if not provided
        let targetBranch = branchName;
        if (!targetBranch) {
          const { stdout } = await execa('git', ['branch', '--list', `agent/issue-${issueNumber}-*`], {
            cwd: this.baseDir,
          });
          const lines = stdout.split('\n').map((l) => l.replace('*', '').trim()).filter(Boolean);
          if (lines[0]) {
            targetBranch = lines[0];
          }
        }

        if (targetBranch) {
          await execa('git', ['branch', '-D', targetBranch], { cwd: this.baseDir });
        }
      } catch {
        // Branch deletion failure is non-fatal
      }
    }
  }

  public async listActiveWorktrees(): Promise<WorktreeInfo[]> {
    try {
      const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: this.baseDir });
      const items: WorktreeInfo[] = [];
      const blocks = stdout.split('\n\n');

      for (const block of blocks) {
        const lines = block.split('\n');
        let currentPath = '';
        let currentBranch = '';

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            currentPath = line.substring(9).trim();
          } else if (line.startsWith('branch ')) {
            currentBranch = line.substring(7).replace('refs/heads/', '').trim();
          }
        }

        if (currentPath && currentPath.includes('.autopilot/worktrees/')) {
          const match = path.basename(currentPath).match(/^issue-(\d+)/);
          const issueNumber = match && match[1] ? parseInt(match[1], 10) : undefined;
          items.push({
            path: currentPath,
            branch: currentBranch,
            issueNumber,
          });
        }
      }
      return items;
    } catch {
      return [];
    }
  }
}
