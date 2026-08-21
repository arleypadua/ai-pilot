import { execa } from 'execa';
import { ActivityLogger } from '../logger/index.js';
import type { GitHubIssue } from '../types/index.js';

/**
 * Options for configuring a {@link GitHubClient} instance.
 */
export interface GitHubClientOptions {
  /**
   * Target repository in `owner/repo` format (e.g. `octocat/Hello-World`).
   */
  repository?: string;
  /**
   * Working directory from which to run `gh` CLI commands.
   * @defaultValue `process.cwd()`
   */
  cwd?: string;
}

/**
 * Options for creating a new pull request via {@link GitHubClient.createPR} or {@link GitHubClient.createPullRequest}.
 */
export interface CreatePROptions {
  /** Title of the pull request */
  title: string;
  /** Markdown body / description of the pull request */
  body: string;
  /** Name of the head branch containing the changes */
  head: string;
  /** Name of the base branch to merge into (e.g. `main`) */
  base: string;
  /** Whether to create the pull request as a draft */
  draft?: boolean;
}

/**
 * Options for modifying labels on an issue via {@link GitHubClient.editIssueLabels}.
 */
export interface EditIssueLabelsOptions {
  /** Array of label names to add to the issue */
  add?: string[];
  /** Array of label names to remove from the issue */
  remove?: string[];
}

/**
 * Options for merging a pull request via {@link GitHubClient.mergePullRequest}.
 */
export interface MergePROptions {
  /**
   * Merge strategy to use (`'squash'`, `'merge'`, or `'rebase'`).
   * @defaultValue `'squash'`
   */
  method?: 'squash' | 'merge' | 'rebase';
  /**
   * Whether to delete the remote head branch after merging.
   * @defaultValue `true`
   */
  deleteBranch?: boolean;
}

/**
 * Client for interacting with GitHub via the GitHub CLI (`gh`).
 * Provides typed methods for issue tracking, labels, comments, reactions, and pull requests.
 */
export class GitHubClient {
  private repository?: string;
  private cwd: string;

  /**
   * Initializes a new instance of the {@link GitHubClient}.
   *
   * @param options - Configuration options including default repository and working directory.
   */
  constructor(options: GitHubClientOptions = {}) {
    this.repository = options.repository;
    this.cwd = options.cwd ?? process.cwd();
  }

  /**
   * Sets or updates the default repository for GitHub CLI operations.
   *
   * @param repo - The target repository in `owner/repo` format (e.g. `octocat/Hello-World`).
   */
  public setRepository(repo: string): void {
    this.repository = repo;
  }

  /**
   * Gets the currently configured default repository.
   *
   * @returns The repository string in `owner/repo` format, or `undefined` if none is configured.
   */
  public getRepository(): string | undefined {
    return this.repository;
  }

  /**
   * Returns repository CLI arguments (`['--repo', repo]`) if a repository is specified.
   *
   * @param overrideRepo - Optional repository override in `owner/repo` format.
   * @returns Array with `--repo` flags or empty array if no repository is configured.
   */
  private repoArgs(overrideRepo?: string): string[] {
    const repo = overrideRepo ?? this.repository;
    return repo ? ['--repo', repo] : [];
  }

  /**
   * Checks whether the current environment is authenticated with GitHub via the `gh` CLI.
   *
   * @returns A promise resolving to `true` if `gh auth status` succeeds, `false` otherwise.
   */
  public async checkAuth(): Promise<boolean> {
    try {
      await execa('gh', ['auth', 'status'], { cwd: this.cwd });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the repository owner and name from the configured repository or current working directory.
   */
  public async getRepoOwnerAndName(overrideRepo?: string): Promise<{ owner: string; repo: string } | undefined> {
    const targetRepo = overrideRepo ?? this.repository;
    if (targetRepo && targetRepo.includes('/')) {
      const [owner, repo] = targetRepo.split('/');
      if (owner && repo) {
        return { owner, repo };
      }
    }

    try {
      const { stdout } = await execa('gh', ['repo', 'view', ...(targetRepo ? [targetRepo] : []), '--json', 'owner,name'], {
        cwd: this.cwd,
      });
      const data = JSON.parse(stdout);
      if (data.owner?.login && data.name) {
        return { owner: data.owner.login, repo: data.name };
      }
    } catch {
      // Ignore error and return undefined
    }

    return undefined;
  }

  /**
   * Fetches issues via GitHub GraphQL API, including native relationships (blockedBy, blocking, parent, subIssues).
   */
  public async fetchIssuesViaGraphQL(owner: string, repoName: string): Promise<GitHubIssue[]> {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          issues(first: 100, states: [OPEN, CLOSED], orderBy: {field: CREATED_AT, direction: DESC}) {
            nodes {
              number
              title
              body
              state
              url
              createdAt
              updatedAt
              labels(first: 50) {
                nodes {
                  name
                  color
                  description
                }
              }
              parent {
                number
                title
              }
              blockedBy(first: 50) {
                nodes {
                  number
                  title
                  state
                }
              }
              blocking(first: 50) {
                nodes {
                  number
                  title
                  state
                }
              }
              subIssues(first: 100) {
                nodes {
                  number
                  title
                  state
                }
              }
            }
          }
        }
      }
    `;

    const { stdout } = await execa(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${owner}`,
        '-F',
        `repo=${repoName}`,
      ],
      { cwd: this.cwd }
    );

    const data = JSON.parse(stdout);
    const issueNodes = data.data?.repository?.issues?.nodes;
    if (!Array.isArray(issueNodes)) {
      throw new Error('GraphQL response did not contain repository issues');
    }

    return issueNodes.map((node: any) => ({
      number: node.number,
      title: node.title,
      body: node.body || '',
      state: node.state,
      url: node.url,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      labels: (node.labels?.nodes || []).map((l: any) => ({
        name: l.name,
        color: l.color,
        description: l.description,
      })),
      parent: node.parent ? { number: node.parent.number, title: node.parent.title } : undefined,
      blockedBy: (node.blockedBy?.nodes || []).map((b: any) => ({
        number: b.number,
        title: b.title,
        state: b.state,
      })),
      blocking: (node.blocking?.nodes || []).map((b: any) => ({
        number: b.number,
        title: b.title,
        state: b.state,
      })),
      subIssues: (node.subIssues?.nodes || []).map((s: any) => ({
        number: s.number,
        title: s.title,
        state: s.state,
      })),
    }));
  }

  /**
   * Fetches issues via standard gh issue list CLI command.
   */
  public async fetchIssuesViaCli(repo?: string): Promise<GitHubIssue[]> {
    const fields = 'number,title,body,state,labels,url,createdAt,updatedAt,comments';
    const args = ['issue', 'list', '--state', 'all', '--limit', '100', ...this.repoArgs(repo), '--json', fields];

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

  /**
   * Fetches issues from the repository using the GitHub GraphQL API, falling back to GitHub CLI list.
   *
   * @param repo - Optional repository override in `owner/repo` format. If omitted, the configured default repository is used.
   * @returns A promise resolving to an array of {@link GitHubIssue} objects.
   * @throws {Error} If the command fails or if the command output cannot be parsed as JSON.
   */
  public async fetchIssues(repo?: string): Promise<GitHubIssue[]> {
    try {
      const repoInfo = await this.getRepoOwnerAndName(repo);
      if (repoInfo) {
        return await this.fetchIssuesViaGraphQL(repoInfo.owner, repoInfo.repo);
      }
    } catch {
      // Fallback to CLI
    }

    return this.fetchIssuesViaCli(repo);
  }

  /**
   * Fetches details of a specific issue by its issue number using the GitHub CLI.
   *
   * @param issueNumber - The issue number to view.
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise resolving to the {@link GitHubIssue} details.
   * @throws {Error} If the `gh issue view` command fails or if output cannot be parsed as JSON.
   */
  public async viewIssue(issueNumber: number, repo?: string): Promise<GitHubIssue> {
    const fields = 'number,title,body,state,labels,url,createdAt,updatedAt,comments';
    const args = ['issue', 'view', String(issueNumber), ...this.repoArgs(repo), '--json', fields];

    const { stdout } = await execa('gh', args, { cwd: this.cwd });
    return JSON.parse(stdout) as GitHubIssue;
  }

  /**
   * Fetches details of a specific issue by its issue number.
   * Alias for {@link viewIssue}.
   *
   * @param issueNumber - The issue number to fetch.
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise resolving to the {@link GitHubIssue} details.
   * @throws {Error} If the `gh issue view` command fails or if output cannot be parsed as JSON.
   */
  public async fetchIssue(issueNumber: number, repo?: string): Promise<GitHubIssue> {
    return this.viewIssue(issueNumber, repo);
  }

  /**
   * Ensures that a label exists on the repository, creating it with a predefined color if missing.
   * Fails silently if the label already exists or if the caller lacks permission to create labels.
   *
   * @param labelName - The name of the label to ensure.
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise that resolves when label creation is completed or handled.
   */
  public async ensureLabelExists(labelName: string, repo?: string): Promise<void> {
    try {
      const colors: Record<string, string> = {
        'ready-for-agent': '0E8A16',
        'needs-info': 'D93F0B',
        'ready-for-human': 'B60205',
        'human-task': 'B60205',
        'human-tasks': 'B60205',
        'needs-triage': 'FBCA04',
        'wontfix': 'FFFFFF',
      };
      const descriptions: Record<string, string> = {
        'ready-for-agent': 'Queued for autonomous agent execution',
        'needs-info': 'Requires more information from developer',
        'ready-for-human': 'Ready for human review, manual task, or merge',
        'human-task': 'Manual task assigned to human developer',
        'human-tasks': 'Manual task assigned to human developer',
        'needs-triage': 'Pending triage / specification',
        'wontfix': 'Will not be implemented',
      };
      const color = colors[labelName] || 'EDEDED';
      const description = descriptions[labelName];
      const args = ['label', 'create', labelName, ...this.repoArgs(repo), '--color', color, '--force'];
      if (description) {
        args.push('--description', description);
      }
      await execa('gh', args, {
        cwd: this.cwd,
      });
    } catch {
      // Label may already exist or lack permission
    }
  }

  /**
   * Ensures that multiple labels exist on the repository.
   *
   * @param labels - Array of label names or a Record of label name mappings to ensure.
   * @param repo - Optional repository override in `owner/repo` format.
   */
  public async ensureLabelsExist(
    labels: string[] | Record<string, string>,
    repo?: string
  ): Promise<void> {
    const labelList = Array.isArray(labels) ? labels : Object.values(labels);
    for (const label of labelList) {
      if (label && typeof label === 'string') {
        await this.ensureLabelExists(label, repo);
      }
    }
  }

  /**
   * Adds and/or removes labels from a GitHub issue.
   * Automatically attempts to create any missing labels if label addition/removal fails and retries once.
   *
   * @param issueNumber - The issue number whose labels should be modified.
   * @param options - Object specifying labels to add and/or remove.
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise that resolves when the issue labels have been updated.
   * @throws {Error} If the `gh issue edit` command fails and the error is not recovered by label creation.
   */
  public async editIssueLabels(
    issueNumber: number,
    options: EditIssueLabelsOptions,
    repo?: string
  ): Promise<void> {
    const args = ['issue', 'edit', String(issueNumber), ...this.repoArgs(repo)];

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
      // If label not found, try creating any missing labels (both added and removed) and retry
      const allLabels = [...(options.add || []), ...(options.remove || [])];
      for (const label of allLabels) {
        await this.ensureLabelExists(label, repo);
      }
      try {
        await execa('gh', args, { cwd: this.cwd });
        return;
      } catch (retryErr: any) {
        // If removal still fails (e.g. lack of permission to create labels), try applying add-only labels
        if (options.add && options.add.length > 0 && options.remove && options.remove.length > 0) {
          try {
            const addOnlyArgs = ['issue', 'edit', String(issueNumber), ...this.repoArgs(repo)];
            for (const label of options.add) {
              addOnlyArgs.push('--add-label', label);
            }
            await execa('gh', addOnlyArgs, { cwd: this.cwd });
            return;
          } catch {
            // Ignore and fall through to warning log
          }
        }
        // Log failure gracefully without crashing caller
        ActivityLogger.warn(`Warning: Could not update labels for issue #${issueNumber}: ${retryErr.message || err.message}`);
      }
    }
  }

  /**
   * Adds a markdown comment to a GitHub issue.
   *
   * @param issueNumber - The number of the issue to comment on.
   * @param body - The markdown content of the comment.
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise that resolves when the comment is successfully added.
   * @throws {Error} If the `gh issue comment` command fails (e.g. network failure, invalid issue, or insufficient permissions).
   */
  public async addComment(issueNumber: number, body: string, repo?: string): Promise<void> {
    const args = ['issue', 'comment', String(issueNumber), ...this.repoArgs(repo), '--body', body];
    await execa('gh', args, { cwd: this.cwd });
  }

  /**
   * Adds an emoji reaction to a comment using either the GitHub GraphQL API or REST API.
   * Fails silently (best-effort) if the reaction cannot be added due to permissions or network issues.
   *
   * @param commentId - The ID of the comment (either a GraphQL node ID starting with `IC_` or a numeric REST ID).
   * @param content - The reaction type to apply (`'EYES'`, `'ROCKET'`, or `'THUMBS_UP'`). Defaults to `'EYES'`.
   * @returns A promise that resolves when the reaction request completes.
   */
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

  /**
   * Closes a GitHub issue, optionally adding a comment before closing.
   *
   * @param issueNumber - The number of the issue to close.
   * @param comment - Optional closing comment to post before closing the issue.
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise that resolves when the issue is closed.
   * @throws {Error} If adding the comment or closing the issue via `gh issue close` fails.
   */
  public async closeIssue(issueNumber: number, comment?: string, repo?: string): Promise<void> {
    if (comment) {
      await this.addComment(issueNumber, comment, repo);
    }
    const args = ['issue', 'close', String(issueNumber), ...this.repoArgs(repo)];
    await execa('gh', args, { cwd: this.cwd });
  }

  /**
   * Creates a new pull request on GitHub.
   *
   * @param options - Pull request configuration options.
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise resolving to an object containing the PR URL and extracted PR number.
   * @throws {Error} If the `gh pr create` command fails (e.g. branch missing, no commits, or PR already exists).
   */
  public async createPR(
    options: CreatePROptions,
    repo?: string
  ): Promise<{ url: string; number: number }> {
    const args = [
      'pr',
      'create',
      ...this.repoArgs(repo),
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

  /**
   * Creates a new pull request on GitHub.
   * Alias for {@link createPR}.
   *
   * @param options - Pull request configuration options.
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise resolving to an object containing the PR URL and extracted PR number.
   * @throws {Error} If the `gh pr create` command fails (e.g. branch missing, no commits, or PR already exists).
   */
  public async createPullRequest(
    options: CreatePROptions,
    repo?: string
  ): Promise<{ url: string; number: number }> {
    return this.createPR(options, repo);
  }

  /**
   * Merges a pull request using the specified merge strategy and optionally deletes the branch.
   * Attempts auto-merge first; falls back to direct merge if auto-merge is not supported.
   *
   * @param prNumberOrBranch - The PR number (e.g. `123`) or branch name to merge.
   * @param method - The merge strategy to use (`'squash'`, `'merge'`, or `'rebase'`). Defaults to `'squash'`.
   * @param deleteBranch - Whether to delete the remote head branch after merging. Defaults to `true`.
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise that resolves when the merge command completes.
   * @throws {Error} If the `gh pr merge` command fails on both auto-merge and direct merge attempts.
   */
  public async mergePR(
    prNumberOrBranch: number | string,
    method: 'squash' | 'merge' | 'rebase' = 'squash',
    deleteBranch: boolean = true,
    repo?: string
  ): Promise<void> {
    const args = [
      'pr',
      'merge',
      String(prNumberOrBranch),
      ...this.repoArgs(repo),
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
        ...this.repoArgs(repo),
        `--${method}`,
      ];
      if (deleteBranch) {
        fallbackArgs.push('--delete-branch');
      }
      await execa('gh', fallbackArgs, { cwd: this.cwd });
    }
  }

  /**
   * Merges a pull request using the specified merge options or method.
   * Convenience wrapper / alias for {@link mergePR}.
   *
   * @param prNumber - The PR number or branch name to merge.
   * @param options - Merge options object or merge strategy string (`'squash'`, `'merge'`, `'rebase'`).
   * @param deleteBranch - Whether to delete the remote head branch after merging (used when `options` is a string or omitted).
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise that resolves when the merge command completes.
   * @throws {Error} If the `gh pr merge` command fails.
   */
  public async mergePullRequest(
    prNumber: number | string,
    options?: MergePROptions | 'squash' | 'merge' | 'rebase',
    deleteBranch: boolean = true,
    repo?: string
  ): Promise<void> {
    if (typeof options === 'object' && options !== null) {
      return this.mergePR(prNumber, options.method ?? 'squash', options.deleteBranch ?? true, repo);
    }
    return this.mergePR(prNumber, options ?? 'squash', deleteBranch, repo);
  }

  /**
   * Finds an existing pull request associated with the specified head branch name.
   * Returns `undefined` if no pull request is found or if the query fails.
   *
   * @param branchName - The head branch name to search for.
   * @param repo - Optional repository override in `owner/repo` format.
   * @returns A promise resolving to PR info `{ url, number, state }` or `undefined` if not found.
   */
  public async findPRForBranch(
    branchName: string,
    repo?: string
  ): Promise<{ url: string; number: number; state: string } | undefined> {
    try {
      const args = ['pr', 'list', '--head', branchName, '--state', 'all', ...this.repoArgs(repo), '--json', 'number,url,state'];
      const { stdout } = await execa('gh', args, { cwd: this.cwd });
      if (!stdout.trim()) return undefined;
      const prs = JSON.parse(stdout);
      if (Array.isArray(prs) && prs.length > 0) {
        return prs[0];
      }
    } catch {
      // Best effort
    }
    return undefined;
  }
}

