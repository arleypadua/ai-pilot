import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { MasterDashboard } from '../src/ui/tui/MasterDashboard.js';
import { InspectView } from '../src/ui/tui/InspectView.js';
import { UsageView } from '../src/ui/tui/UsageView.js';
import { SpecPickerView } from '../src/ui/tui/SpecPickerView.js';
import { ActivityLogView } from '../src/ui/tui/ActivityLogView.js';
import { CategoryIssuesView } from '../src/ui/tui/CategoryIssuesView.js';

describe('TUI Components', () => {
  const dummyConfig: any = {
    repository: 'owner/test-repo',
    baseBranch: 'main',
    maxConcurrency: 2,
    pollIntervalSeconds: 30,
    runner: 'claude',
    autoMerge: true,
    mergeMethod: 'squash',
    cleanupWorktreeOnClose: true,
    quota: { pauseOnLimit: true, utilizationThreshold: 0.95 },
    labels: {
      readyForAgent: 'ready-for-agent',
      needsInfo: 'needs-info',
      readyForHuman: 'ready-for-human',
      needsTriage: 'needs-triage',
      wontfix: 'wontfix',
    },
  };

  it('should render MasterDashboard with worker list and quota', () => {
    const { lastFrame } = render(
      <MasterDashboard
        config={dummyConfig}
        dag={null}
        quotaStatus={null}
        workers={[
          {
            issueNumber: 101,
            title: 'Fix authorization token expiry',
            branchName: 'fix/101-auth',
            status: 'running',
            startedAt: new Date(Date.now() - 65000),
          },
        ]}
        selectedIndex={0}
        activityLogs={['[17:00:00] Daemon started']}
      />
    );

    const output = lastFrame();
    expect(output).toContain('AGENT AUTO-PILOT');
    expect(output).toContain('owner/test-repo');
    expect(output).toContain('#101');
    expect(output).toContain('Fix authorization');
    expect(output).toContain('running');
    expect(output).toContain('Navigate');
  });

  it('should render InspectView with activity stream and prompt input bar', () => {
    const { lastFrame } = render(
      <InspectView
        worker={{
          issueNumber: 101,
          title: 'Fix authorization token expiry',
          branchName: 'fix/101-auth',
          status: 'running',
        }}
        events={[
          {
            id: 'evt-1',
            issueNumber: 101,
            type: 'tool_start',
            timestamp: '17:08:12',
            summary: '🔧 EditFile: src/auth/token.ts',
          },
          {
            id: 'evt-2',
            issueNumber: 101,
            type: 'thought',
            timestamp: '17:08:15',
            summary: 'Checking JWT verification logic',
          },
        ]}
        inputText="Make sure to check expired tokens"
        isSubmitting={false}
      />
    );

    const output = lastFrame();
    expect(output).toContain('LIVE TAIL: Issue #101');
    expect(output).toContain('🔧 EditFile: src/auth/token.ts');
    expect(output).toContain('Checking JWT verification logic');
    expect(output).toContain('❯ Inject prompt: Make sure to check expired tokens');
    expect(output).toContain('[Esc] Back to Overview');
  });

  it('should render paused WIP worktrees on disk in MasterDashboard table', () => {
    const { lastFrame } = render(
      <MasterDashboard
        config={dummyConfig}
        dag={null}
        quotaStatus={{
          isPaused: true,
          resetAt: new Date(Date.now() + 1000 * 60 * 256),
          reason: '5-hour limit reached',
        }}
        workers={[
          {
            issueNumber: 221,
            title: "The CLI's App-slot refusal point",
            branchName: 'agent/issue-221-the-cli-s',
            status: 'paused_quota',
            isWip: true,
          },
        ]}
        selectedIndex={0}
        activityLogs={['[17:44:08] 5h Quota limit hit. Suspended workers until 10:00 PM']}
      />
    );

    const output = lastFrame();
    expect(output).toContain('5-HOUR QUOTA PAUSED');
    expect(output).toContain('#221');
    expect(output).toContain("The CLI's App-slot");
    expect(output).toContain('agent/issue-221');
    expect(output).toContain('paused');
    expect(output).toContain('preserves WIP');
  });

  it('should render CommandPalette in command input mode and display suggestions', () => {
    const { lastFrame } = render(
      <MasterDashboard
        config={dummyConfig}
        dag={null}
        quotaStatus={null}
        workers={[]}
        selectedIndex={0}
        activityLogs={[]}
        commandInput="/us"
        isCommandMode={true}
      />
    );

    const output = lastFrame();
    expect(output).toContain('COMMAND PALETTE');
    expect(output).toContain('❯ /usage');
    expect(output).toContain('❯ Command: /us');
    expect(output).toContain('(press [Tab] for /usage)');
  });

  it('should render command result telemetry box when /usage is executed', () => {
    const { lastFrame } = render(
      <MasterDashboard
        config={dummyConfig}
        dag={null}
        quotaStatus={null}
        workers={[]}
        selectedIndex={0}
        activityLogs={[]}
        commandResult={{
          type: 'usage',
          title: '📊 Quota Usage & Scheduled Wake-Up Telemetry',
          lines: [
            '● 5h Session Quota: [████████████] 100% used · Resets 10:00:00 PM',
            '⏳ Scheduled Wake-Up: 10:00:00 PM (~256 min remaining)',
            'Status: 5-hour quota paused (waiting for wake-up time)',
          ],
        }}
      />
    );

    const output = lastFrame();
    expect(output).toContain('Quota Usage & Scheduled Wake-Up Telemetry');
    expect(output).toContain('5h Session Quota: [████████████] 100% used');
    expect(output).toContain('Scheduled Wake-Up: 10:00:00 PM (~256 min remaining)');
  });

  it('should render dedicated UsageView window with scheduled wake up and quota bars', () => {
    const { lastFrame } = render(
      <UsageView
        quotaStatus={{
          isPaused: true,
          resetAt: new Date(Date.now() + 1000 * 60 * 256),
          reason: '5-hour limit reached',
          activePids: [1234],
          liveUsage: {
            sessionUsedPercentage: 100,
            sessionResetText: 'Aug 19 at 10:00pm',
            weekUsedPercentage: 62,
            weekResetText: 'Aug 24 at 10:59pm',
            lastFetchedAt: new Date(),
          },
        }}
        repository="owner/test-repo"
      />
    );

    const output = lastFrame();
    expect(output).toContain('LLM RUNNER QUOTA & SCHEDULED WAKE-UP TELEMETRY');
    expect(output).toContain('CLAUDE CODE CLI TELEMETRY');
    expect(output).toContain('5-Hour Session Quota');
    expect(output).toContain('100%');
    expect(output).toContain('Aug 19 at 10:00pm');
    expect(output).toContain('Weekly Account Quota');
    expect(output).toContain('62%');
    expect(output).toContain('SCHEDULED WAKE-UP STATUS (PAUSED)');
    expect(output).toContain('[Esc] Back to Main Dashboard');
  });

  it('should render SpecPickerView window with multi-select checkboxes and any unblocked task', () => {
    const { lastFrame } = render(
      <SpecPickerView
        options={[
          {
            number: 205,
            title: 'Fix authorization token verification',
            childCount: 4,
            completedCount: 1,
          },
          {
            number: 187,
            title: 'Refactor DAG scheduler pipeline',
            childCount: 6,
            completedCount: 0,
          },
          {
            title: 'Any unblocked task (all ready-for-agent issues)',
            isAllTasks: true,
          },
        ]}
        highlightedIndex={0}
        selectedNumbers={new Set([205, 187])}
        isAllTasksSelected={false}
        repository="owner/test-repo"
      />
    );

    const output = lastFrame();
    expect(output).toContain('SELECT TARGET SPECIFICATION SCOPE');
    expect(output).toContain('[x]');
    expect(output).toContain('#205');
    expect(output).toContain('Fix authorization token ver');
    expect(output).toContain('(1/4 sub-tasks complete)');
    expect(output).toContain('#187');
    expect(output).toContain('2 specs selected (#205, #187)');
    expect(output).toContain('[Space] Toggle');
    expect(output).toContain('[Enter] Start Session');
  });

  it('should render ActivityLogView window with full system logs and scroll footer', () => {
    const { lastFrame } = render(
      <ActivityLogView
        logs={[
          '[18:00:00] Agent Auto-Pilot started.',
          '[18:00:02] Fetched 12 issues from GitHub.',
          '[18:00:05] Started session scoped to Spec(s): #205',
          '[18:00:08] Dispatched Issue #206 to worker.',
        ]}
        repository="owner/test-repo"
      />
    );

    const output = lastFrame();
    expect(output).toContain('SYSTEM & DAEMON ACTIVITY LOGS');
    expect(output).toContain('Agent Auto-Pilot started.');
    expect(output).toContain('Started session scoped to Spec(s): #205');
    expect(output).toContain('Dispatched Issue #206 to worker.');
    expect(output).toContain('[Esc] Back to Main Dashboard');
    expect(output).toContain('[c] Clear Logs');
  });

  it('should render CategoryIssuesView window with issues list and actions', () => {
    const { lastFrame } = render(
      <CategoryIssuesView
        categoryTitle="Ready for Agent"
        issues={[
          {
            issue: {
              number: 206,
              title: 'Implement token caching layer',
              state: 'OPEN',
              labels: [{ name: 'ready-for-agent' }],
              created_at: '2026-08-19T10:00:00Z',
              updated_at: '2026-08-19T10:00:00Z',
              comments: 0,
            },
            status: 'ready',
            worker: {
              issueNumber: 206,
              title: 'Implement token caching layer',
              branchName: 'agent/issue-206',
              status: 'running',
              startedAt: new Date(Date.now() - 65000),
            },
          },
          {
            issue: {
              number: 207,
              title: 'Add JWT unit tests',
              state: 'OPEN',
              labels: [{ name: 'ready-for-agent' }],
              created_at: '2026-08-19T10:00:00Z',
              updated_at: '2026-08-19T10:00:00Z',
              comments: 0,
            },
            status: 'ready',
          },
        ]}
        selectedIndex={0}
        repository="owner/test-repo"
      />
    );

    const output = lastFrame();
    expect(output).toContain('ISSUES: READY FOR AGENT');
    expect(output).toContain('#206');
    expect(output).toContain('Implement token caching layer');
    expect(output).toContain('active worker');
    expect(output).toContain('#207');
    expect(output).toContain('[p] Pause/Resume');
    expect(output).toContain('[k] Kill & Wipe');
    expect(output).toContain('[o] Open in Browser');
  });

  it('should render CategoryIssuesView with kill confirmation modal when requested', () => {
    const { lastFrame } = render(
      <CategoryIssuesView
        categoryTitle="Ready for Agent"
        issues={[
          {
            issue: {
              number: 206,
              title: 'Implement token caching layer',
              state: 'OPEN',
              labels: [{ name: 'ready-for-agent' }],
              created_at: '2026-08-19T10:00:00Z',
              updated_at: '2026-08-19T10:00:00Z',
              comments: 0,
            },
            status: 'ready',
          },
        ]}
        selectedIndex={0}
        confirmAction={{ type: 'kill', issueNumber: 206 }}
        repository="owner/test-repo"
      />
    );

    const output = lastFrame();
    expect(output).toContain('CONFIRM KILL & WIPE WORKTREE: Issue #206');
    expect(output).toContain('Press [y] to confirm and wipe, or [n] / [Esc] to cancel');
  });
});
