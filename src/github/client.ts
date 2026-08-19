import { execa } from 'execa';
import type { GitHubIssue } from '../types/index.js';

export interface GitHubClientOptions {
  repository?: string;
  cwd?: string;
}

export class GitHubClient {
  private repository?: string;
  private cwd: string;

  constructor(options: GitHubClientOptions = {}) {
    this.repository = options.repository;
    this.cwd = options.cwd ?? process.cwd();
  }

  public setRepository(repo: string): void {
    this.repository = repo;
  }

  public getRepository(): string | undefined {
    return this.repository;
  }

  private repoArgs(): string[] {
    return this.repository ? ['--repo', this.repository] : [];
  }

  public async checkAuth(): Promise<boolean> {
    try {
      await execa('gh', ['auth', 'status'], { cwd: this.cwd });
      return true;
    } catch {
      return false;
    }
  }

  public async fetchIssues(): Promise<GitHubIssue[]> {
    const fields = 'number,title,body,state,labels,url,createdAt,updatedAt,comments';
    const args = ['issue', 'list', '--state', 'all', '--limit', '100', ...this.repoArgs(), '--json', fields];

    const { stdout } = await execa('gh', args, { cwd: this.cwd });
    if (!stdout.trim()) {
      return [];
    }

    try {
      const issues: GitHubIssue[] = JSON.parse(stdout);
      return issues;
    } catch (err) {
      throw new Error(`Failed to parse gh issue list output: ${err}\nOutput was: ${stdout}`);
    }
  }

  public async viewIssue(issueNumber: number): Promise<GitHubIssue> {
    const fields = 'number,title,body,state,labels,url,createdAt,updatedAt,comments';
    const args = ['issue', 'view', String(issueNumber), ...this.repoArgs(), '--json', fields];

    const { stdout } = await execa('gh', args, { cwd: this.cwd });
    return JSON.parse(stdout) as GitHubIssue;
  }

  public async ensureLabelExists(labelName: string): Promise<void> {
    try {
      const colors: Record<string, string> = {
        'ready-for-agent': '0E8A16',
        'needs-info': 'D93F0B',
        'ready-for-human': 'B60205',
        'needs-triage': 'FBCA04',
        'wontfix': 'FFFFFF',
      };
      const color = colors[labelName] || 'EDEDED';
      await execa('gh', ['label', 'create', labelName, ...this.repoArgs(), '--color', color, '--force'], {
        cwd: this.cwd,
      });
    } catch {
      // Label may already exist or lack permission
    }
  }

  public async editIssueLabels(
    issueNumber: number,
    options: { add?: string[]; remove?: string[] }
  ): Promise<void> {
    const args = ['issue', 'edit', String(issueNumber), ...this.repoArgs()];

    if (options.add && options.add.length > 0) {
      for (const label of options.add) {
        args.push('--add-label', label);
      }
    }

    if (options.remove && options.remove.length > 0) {
      for (const label of options.remove) {
        args.push('--remove-label', label);
      }
    }

    try {
      await execa('gh', args, { cwd: this.cwd });
    } catch (err: any) {
      // If label not found, try creating the label and retry once
      if (options.add && options.add.length > 0) {
        for (const label of options.add) {
          await this.ensureLabelExists(label);
        }
        try {
          await execa('gh', args, { cwd: this.cwd });
          return;
        } catch {
          // Log failure gracefully without crashing caller
          console.warn(`Warning: Could not update labels for issue #${issueNumber}: ${err.message}`);
        }
      }
    }
  }

  public async addComment(issueNumber: number, body: string): Promise<void> {
    const args = ['issue', 'comment', String(issueNumber), ...this.repoArgs(), '--body', body];
    await execa('gh', args, { cwd: this.cwd });
  }

  public async addCommentReaction(
    commentId: string,
    content: 'EYES' | 'ROCKET' | 'THUMBS_UP' = 'EYES'
  ): Promise<void> {
    try {
      if (commentId.startsWith('IC_') || commentId.length > 15) {
        const query = `mutation($subjectId: ID!, $content: ReactionContent!) {
          addReaction(input: { subjectId: $subjectId, content: $content }) {
            reaction { content }
          }
        }`;
        await execa(
          'gh',
          ['api', 'graphql', '-f', `query=${query}`, '-F', `subjectId=${commentId}`, '-F', `content=${content}`],
          { cwd: this.cwd }
        );
      } else {
        const restContent = content === 'EYES' ? 'eyes' : content === 'ROCKET' ? 'rocket' : '+1';
        const endpoint = this.repository
          ? `repos/${this.repository}/issues/comments/${commentId}/reactions`
          : `repos/:owner/:repo/issues/comments/${commentId}/reactions`;
        await execa('gh', ['api', endpoint, '-f', `content=${restContent}`], { cwd: this.cwd });
      }
    } catch {
      // Best-effort reaction; non-fatal if permissions or network fail
    }
  }

  public async closeIssue(issueNumber: number, comment?: string): Promise<void> {
    if (comment) {
      await this.addComment(issueNumber, comment);
    }
    const args = ['issue', 'close', String(issueNumber), ...this.repoArgs()];
    await execa('gh', args, { cwd: this.cwd });
  }

  public async createPR(options: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }): Promise<{ url: string; number: number }> {
    const args = [
      'pr',
      'create',
      ...this.repoArgs(),
      '--title',
      options.title,
      '--body',
      options.body,
      '--head',
      options.head,
      '--base',
      options.base,
    ];

    if (options.draft) {
      args.push('--draft');
    }

    const { stdout } = await execa('gh', args, { cwd: this.cwd });
    const prUrl = stdout.trim();
    // Extract PR number from url (e.g. https://github.com/owner/repo/pull/123)
    const match = prUrl.match(/\/pull\/(\d+)$/);
    const prNumber = match && match[1] ? parseInt(match[1], 10) : 0;

    return { url: prUrl, number: prNumber };
  }

  public async mergePR(
    prNumberOrBranch: number | string,
    method: 'squash' | 'merge' | 'rebase' = 'squash',
    deleteBranch: boolean = true
  ): Promise<void> {
    const args = [
      'pr',
      'merge',
      String(prNumberOrBranch),
      ...this.repoArgs(),
      `--${method}`,
      '--auto',
    ];

    if (deleteBranch) {
      args.push('--delete-branch');
    }

    try {
      await execa('gh', args, { cwd: this.cwd });
    } catch {
      // If --auto fails (e.g. branch protection does not require checks), try direct merge
      const fallbackArgs = [
        'pr',
        'merge',
        String(prNumberOrBranch),
        ...this.repoArgs(),
        `--${method}`,
      ];
      if (deleteBranch) {
        fallbackArgs.push('--delete-branch');
      }
      await execa('gh', fallbackArgs, { cwd: this.cwd });
    }
  }
}
