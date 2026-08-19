import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorktreeManager } from '../src/worktree/manager.js';

describe('WorktreeManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagos-worktree-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getBranchName', () => {
    it('should generate clean kebab-case branch names in agent/issue-<num>-<slug> format', () => {
      const manager = new WorktreeManager(tmpDir);
      const branch = manager.getBranchName(42, 'add user authentication');
      expect(branch).toBe('agent/issue-42-add-user-authentication');
    });

    it('should convert uppercase characters to lowercase', () => {
      const manager = new WorktreeManager(tmpDir);
      const branch = manager.getBranchName(10, 'Feat: Add OAuth2 Support');
      expect(branch).toBe('agent/issue-10-feat-add-oauth2-support');
    });

    it('should strip special characters, spaces, and punctuation', () => {
      const manager = new WorktreeManager(tmpDir);
      const branch = manager.getBranchName(7, 'fix(parser): handle $#@! & symbols??');
      expect(branch).toBe('agent/issue-7-fix-parser-handle-symbols');
    });

    it('should strip leading and trailing hyphens from the slug', () => {
      const manager = new WorktreeManager(tmpDir);
      const branch = manager.getBranchName(15, '---clean--slug---');
      expect(branch).toBe('agent/issue-15-clean-slug');
    });

    it('should safely truncate slugs exceeding 30 characters', () => {
      const manager = new WorktreeManager(tmpDir);
      const longTitle = 'test: add unit tests for WorktreeManager branch naming and slug sanitization';
      const branch = manager.getBranchName(4, longTitle);

      // Slug part should be at most 30 characters
      const slug = branch.replace('agent/issue-4-', '');
      expect(slug).toBe('test-add-unit-tests-for-worktr');
      expect(slug.length).toBeLessThanOrEqual(30);
      expect(branch).toBe('agent/issue-4-test-add-unit-tests-for-worktr');
    });

    it('should handle very long repetitive strings by truncating to 30 characters', () => {
      const manager = new WorktreeManager(tmpDir);
      const longTitle = 'a'.repeat(100);
      const branch = manager.getBranchName(99, longTitle);
      expect(branch).toBe(`agent/issue-99-${'a'.repeat(30)}`);
    });
  });

  describe('getWorktreePathForIssue', () => {
    it('should resolve paths inside .autopilot/worktrees/ with sanitized slug when title is provided', () => {
      const manager = new WorktreeManager(tmpDir);
      const expectedRoot = path.resolve(tmpDir, '.autopilot', 'worktrees');
      const worktreePath = manager.getWorktreePathForIssue(42, 'Add user authentication');

      expect(worktreePath).toBe(path.join(expectedRoot, 'issue-42-add-user-authentication'));
      expect(worktreePath.startsWith(expectedRoot)).toBe(true);
    });

    it('should resolve default path inside .autopilot/worktrees/ when title is omitted and directory does not exist', () => {
      const manager = new WorktreeManager(tmpDir);
      const expectedPath = path.resolve(tmpDir, '.autopilot', 'worktrees', 'issue-42');
      const worktreePath = manager.getWorktreePathForIssue(42);

      expect(worktreePath).toBe(expectedPath);
    });

    it('should discover and resolve existing worktree directory matching issue number prefix when title is omitted', () => {
      const manager = new WorktreeManager(tmpDir);
      const worktreesRoot = manager.getWorktreesRoot();
      const existingWorktreeDir = path.join(worktreesRoot, 'issue-42-custom-slug');

      fs.mkdirSync(existingWorktreeDir, { recursive: true });

      const worktreePath = manager.getWorktreePathForIssue(42);
      expect(worktreePath).toBe(existingWorktreeDir);
    });
  });

  describe('getWorktreesRoot', () => {
    it('should return .autopilot/worktrees inside the base directory', () => {
      const manager = new WorktreeManager(tmpDir);
      expect(manager.getWorktreesRoot()).toBe(path.resolve(tmpDir, '.autopilot', 'worktrees'));
    });

    it('should default to process.cwd() if baseDir is not provided', () => {
      const manager = new WorktreeManager();
      expect(manager.getWorktreesRoot()).toBe(path.resolve(process.cwd(), '.autopilot', 'worktrees'));
    });
  });

  describe('worktreeExists', () => {
    it('should return true if worktree path exists on filesystem', async () => {
      const manager = new WorktreeManager(tmpDir);
      const worktreePath = manager.getWorktreePathForIssue(100, 'Test Feature');
      fs.mkdirSync(worktreePath, { recursive: true });

      const exists = await manager.worktreeExists(100);
      expect(exists).toBe(true);
    });

    it('should return false if worktree path does not exist', async () => {
      const manager = new WorktreeManager(tmpDir);
      const exists = await manager.worktreeExists(999);
      expect(exists).toBe(false);
    });
  });
});
