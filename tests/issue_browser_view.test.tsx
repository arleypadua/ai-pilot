import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { IssueBrowserView, type FlatTreeItem } from '../src/ui/tui/IssueBrowserView.js';

describe('IssueBrowserView Component', () => {
  it('should render empty state message when no items exist', () => {
    const { lastFrame } = render(
      <IssueBrowserView
        items={[]}
        selectedIndex={0}
        totalSpecsCount={0}
        totalStandaloneCount={0}
        repository="owner/repo"
      />
    );
    const output = lastFrame() || '';
    expect(output).toContain('ISSUE TREE BROWSER');
    expect(output).toContain('No open issues or specifications found in repository.');
  });

  it('should render hierarchy with specs, expanded child tickets, and standalone issues', () => {
    const items: FlatTreeItem[] = [
      {
        type: 'spec',
        number: 10,
        title: 'Authentication Module',
        status: 'pending',
        isComplete: false,
        totalTickets: 2,
        completedTickets: 1,
        isExpanded: true,
        labels: ['feature', 'epic'],
        issue: {
          number: 10,
          title: 'Authentication Module',
          state: 'OPEN',
          body: '',
          labels: [{ name: 'feature' }],
          comments: [],
          author: { login: 'alice' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      {
        type: 'child',
        number: 11,
        title: 'JWT Auth Filter',
        status: 'ready',
        state: 'OPEN',
        isClosed: false,
        parentSpecNumber: 10,
        isLast: false,
        labels: ['ready-for-agent'],
        worker: {
          issueNumber: 11,
          title: 'JWT Auth Filter',
          branchName: 'issue-11',
          status: 'running',
        },
      },
      {
        type: 'child',
        number: 12,
        title: 'Login Controller',
        status: 'completed',
        state: 'CLOSED',
        isClosed: true,
        parentSpecNumber: 10,
        isLast: true,
        labels: [],
      },
      {
        type: 'standalone',
        number: 20,
        title: 'Fix SQLite Connection Pool',
        status: 'ready',
        blockers: [5],
        labels: ['bug'],
        issue: {
          number: 20,
          title: 'Fix SQLite Connection Pool',
          state: 'OPEN',
          body: '',
          labels: [{ name: 'bug' }],
          comments: [],
          author: { login: 'bob' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    ];

    const { lastFrame } = render(
      <IssueBrowserView
        items={items}
        selectedIndex={0}
        totalSpecsCount={1}
        totalStandaloneCount={1}
        repository="owner/repo"
      />
    );

    const output = lastFrame() || '';
    expect(output).toContain('ISSUE TREE BROWSER');
    expect(output).toContain('[Spec #10] Authentication Module');
    expect(output).toContain('├── #11 JWT Auth Filter');
    expect(output).toContain('└── #12 Login Controller');
    expect(output).toContain('● #20 Fix SQLite Connection Pool');
    expect(output).toContain('Specification #10: Authentication Module');
    expect(output).toContain('1 of 2 child tickets completed (50%)');
  });

  it('should render enqueue confirmation modal when confirmAction type is enqueue', () => {
    const items: FlatTreeItem[] = [
      {
        type: 'standalone',
        number: 42,
        title: 'Blocked Task',
        status: 'blocked',
        blockers: [10],
        labels: [],
        issue: {
          number: 42,
          title: 'Blocked Task',
          state: 'OPEN',
          body: '',
          labels: [],
          comments: [],
          author: { login: 'carol' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    ];

    const { lastFrame } = render(
      <IssueBrowserView
        items={items}
        selectedIndex={0}
        totalSpecsCount={0}
        totalStandaloneCount={1}
        confirmAction={{
          type: 'enqueue',
          issueNumber: 42,
          message: 'Issue #42 is blocked by #10. Enqueue anyway?',
        }}
      />
    );

    const output = lastFrame() || '';
    expect(output).toContain('CONFIRM PRIORITY ENQUEUE: Issue #42');
    expect(output).toContain('Issue #42 is blocked by #10. Enqueue anyway?');
    expect(output).toContain('Press [y] to confirm and enqueue, or [n] / [Esc] to cancel.');
  });

  it('should render kill confirmation modal when confirmAction type is kill', () => {
    const items: FlatTreeItem[] = [
      {
        type: 'standalone',
        number: 42,
        title: 'Running Task',
        status: 'ready',
        worker: {
          issueNumber: 42,
          title: 'Running Task',
          branchName: 'issue-42',
          status: 'running',
        },
        labels: [],
        issue: {
          number: 42,
          title: 'Running Task',
          state: 'OPEN',
          body: '',
          labels: [],
          comments: [],
          author: { login: 'carol' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    ];

    const { lastFrame } = render(
      <IssueBrowserView
        items={items}
        selectedIndex={0}
        totalSpecsCount={0}
        totalStandaloneCount={1}
        confirmAction={{
          type: 'kill',
          issueNumber: 42,
        }}
      />
    );

    const output = lastFrame() || '';
    expect(output).toContain('CONFIRM KILL & WIPE WORKTREE: Issue #42');
    expect(output).toContain('Press [y] to confirm and wipe, or [n] / [Esc] to cancel.');
  });

  it('should render filter indicator when showOnlyOpen is true or false', () => {
    const { lastFrame: frameOpenOnly } = render(
      <IssueBrowserView
        items={[]}
        selectedIndex={0}
        totalSpecsCount={0}
        totalStandaloneCount={0}
        showOnlyOpen={true}
      />
    );
    expect(frameOpenOnly() || '').toContain('Filter: Open Only');
    expect(frameOpenOnly() || '').toContain('[c] Show All');

    const { lastFrame: frameAll } = render(
      <IssueBrowserView
        items={[]}
        selectedIndex={0}
        totalSpecsCount={0}
        totalStandaloneCount={0}
        showOnlyOpen={false}
      />
    );
    expect(frameAll() || '').toContain('Filter: All Tasks');
    expect(frameAll() || '').toContain('[c] Open Only');
  });
});
