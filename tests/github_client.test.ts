import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubClient } from '../src/github/client.js';
import { execa } from 'execa';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('GitHubClient', () => {
  const mockedExeca = vi.mocked(execa);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize repository and cwd from options', () => {
    const client = new GitHubClient({ repository: 'owner/repo', cwd: '/custom/dir' });
    expect(client.getRepository()).toBe('owner/repo');

    client.setRepository('other/repo');
    expect(client.getRepository()).toBe('other/repo');
  });

  describe('checkAuth', () => {
    it('should return true when gh auth status succeeds', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: 'Logged in' } as any);
      const client = new GitHubClient();
      const authed = await client.checkAuth();
      expect(authed).toBe(true);
      expect(mockedExeca).toHaveBeenCalledWith('gh', ['auth', 'status'], { cwd: expect.any(String) });
    });

    it('should return false when gh auth status throws', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('Not logged in'));
      const client = new GitHubClient();
      const authed = await client.checkAuth();
      expect(authed).toBe(false);
    });
  });

  describe('fetchIssues', () => {
    it('should fetch and parse issues with repo flag', async () => {
      const mockIssues = [
        { number: 1, title: 'Issue 1', body: 'Body 1', state: 'OPEN', labels: [], url: 'https://...', createdAt: '', updatedAt: '' },
      ];
      mockedExeca.mockResolvedValueOnce({ stdout: JSON.stringify(mockIssues) } as any);

      const client = new GitHubClient({ repository: 'owner/repo' });
      const issues = await client.fetchIssues();

      expect(issues).toEqual(mockIssues);
      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['issue', 'list', '--repo', 'owner/repo']),
        expect.any(Object)
      );
    });

    it('should allow overriding repo parameter', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: '[]' } as any);

      const client = new GitHubClient({ repository: 'default/repo' });
      const issues = await client.fetchIssues('custom/repo');

      expect(issues).toEqual([]);
      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['issue', 'list', '--repo', 'custom/repo']),
        expect.any(Object)
      );
    });

    it('should return empty array if output is blank', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: '   ' } as any);

      const client = new GitHubClient();
      const issues = await client.fetchIssues();
      expect(issues).toEqual([]);
    });

    it('should throw error on invalid JSON output', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: 'invalid json' } as any);

      const client = new GitHubClient();
      await expect(client.fetchIssues()).rejects.toThrow('Failed to parse gh issue list output');
    });
  });

  describe('viewIssue and fetchIssue', () => {
    it('should fetch single issue by number', async () => {
      const mockIssue = { number: 42, title: 'Issue 42', body: 'Body', state: 'OPEN', labels: [], url: 'https://...', createdAt: '', updatedAt: '' };
      mockedExeca.mockResolvedValueOnce({ stdout: JSON.stringify(mockIssue) } as any);

      const client = new GitHubClient({ repository: 'owner/repo' });
      const issue = await client.viewIssue(42);

      expect(issue).toEqual(mockIssue);
      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['issue', 'view', '42', '--repo', 'owner/repo']),
        expect.any(Object)
      );
    });

    it('fetchIssue alias should delegate to viewIssue', async () => {
      const mockIssue = { number: 7, title: 'Issue 7', body: '', state: 'OPEN', labels: [], url: '', createdAt: '', updatedAt: '' };
      mockedExeca.mockResolvedValueOnce({ stdout: JSON.stringify(mockIssue) } as any);

      const client = new GitHubClient();
      const issue = await client.fetchIssue(7);

      expect(issue).toEqual(mockIssue);
      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['issue', 'view', '7']),
        expect.any(Object)
      );
    });
  });

  describe('editIssueLabels', () => {
    it('should edit labels with add and remove options', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: '' } as any);

      const client = new GitHubClient({ repository: 'owner/repo' });
      await client.editIssueLabels(10, { add: ['ready-for-agent'], remove: ['needs-info'] });

      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '10', '--repo', 'owner/repo', '--add-label', 'ready-for-agent', '--remove-label', 'needs-info'],
        expect.any(Object)
      );
    });

    it('should attempt label creation and retry if initial edit fails', async () => {
      mockedExeca
        .mockRejectedValueOnce(new Error('label not found'))
        .mockResolvedValueOnce({ stdout: '' } as any) // label create
        .mockResolvedValueOnce({ stdout: '' } as any); // retry edit

      const client = new GitHubClient();
      await client.editIssueLabels(10, { add: ['custom-label'] });

      expect(mockedExeca).toHaveBeenCalledTimes(3);
    });
  });

  describe('addComment and closeIssue', () => {
    it('should add comment to issue', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: '' } as any);

      const client = new GitHubClient({ repository: 'owner/repo' });
      await client.addComment(5, 'Test comment');

      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        ['issue', 'comment', '5', '--repo', 'owner/repo', '--body', 'Test comment'],
        expect.any(Object)
      );
    });

    it('should close issue with optional comment', async () => {
      mockedExeca.mockResolvedValue({ stdout: '' } as any);

      const client = new GitHubClient({ repository: 'owner/repo' });
      await client.closeIssue(5, 'Closing now');

      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        ['issue', 'comment', '5', '--repo', 'owner/repo', '--body', 'Closing now'],
        expect.any(Object)
      );
      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        ['issue', 'close', '5', '--repo', 'owner/repo'],
        expect.any(Object)
      );
    });
  });

  describe('createPR and createPullRequest', () => {
    it('should create PR and return url and parsed number', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: 'https://github.com/owner/repo/pull/123\n' } as any);

      const client = new GitHubClient({ repository: 'owner/repo' });
      const result = await client.createPR({
        title: 'Feature: Docs',
        body: 'Closes #7',
        head: 'agent/branch',
        base: 'main',
        draft: true,
      });

      expect(result).toEqual({ url: 'https://github.com/owner/repo/pull/123', number: 123 });
      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        ['pr', 'create', '--repo', 'owner/repo', '--title', 'Feature: Docs', '--body', 'Closes #7', '--head', 'agent/branch', '--base', 'main', '--draft'],
        expect.any(Object)
      );
    });

    it('createPullRequest alias should delegate to createPR', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: 'https://github.com/owner/repo/pull/99\n' } as any);

      const client = new GitHubClient();
      const result = await client.createPullRequest({
        title: 'PR Title',
        body: 'PR Body',
        head: 'branch',
        base: 'main',
      });

      expect(result.number).toBe(99);
    });
  });

  describe('mergePR and mergePullRequest', () => {
    it('should merge PR with auto-merge and delete-branch', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: '' } as any);

      const client = new GitHubClient({ repository: 'owner/repo' });
      await client.mergePR(123, 'squash', true);

      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        ['pr', 'merge', '123', '--repo', 'owner/repo', '--squash', '--auto', '--delete-branch'],
        expect.any(Object)
      );
    });

    it('should fallback to direct merge when auto-merge fails', async () => {
      mockedExeca
        .mockRejectedValueOnce(new Error('auto merge failed'))
        .mockResolvedValueOnce({ stdout: '' } as any);

      const client = new GitHubClient();
      await client.mergePR(123, 'rebase', false);

      expect(mockedExeca).toHaveBeenCalledTimes(2);
      expect(mockedExeca).toHaveBeenLastCalledWith(
        'gh',
        ['pr', 'merge', '123', '--rebase'],
        expect.any(Object)
      );
    });

    it('mergePullRequest supports options object or string', async () => {
      mockedExeca.mockResolvedValue({ stdout: '' } as any);

      const client = new GitHubClient();
      await client.mergePullRequest(123, { method: 'merge', deleteBranch: false });

      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        ['pr', 'merge', '123', '--merge', '--auto'],
        expect.any(Object)
      );
    });
  });

  describe('findPRForBranch', () => {
    it('should return found PR details', async () => {
      const mockPRs = [{ number: 50, url: 'https://github.com/owner/repo/pull/50', state: 'OPEN' }];
      mockedExeca.mockResolvedValueOnce({ stdout: JSON.stringify(mockPRs) } as any);

      const client = new GitHubClient({ repository: 'owner/repo' });
      const pr = await client.findPRForBranch('feat/test');

      expect(pr).toEqual(mockPRs[0]);
    });

    it('should return undefined if no PR found', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: '[]' } as any);

      const client = new GitHubClient();
      const pr = await client.findPRForBranch('feat/none');

      expect(pr).toBeUndefined();
    });
  });
});
