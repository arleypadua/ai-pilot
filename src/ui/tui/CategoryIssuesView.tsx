import React from 'react';
import { Box, Text } from 'ink';
import type { GitHubIssue, TaskStatus } from '../../types/index.js';
import type { WorkerItem } from './MasterDashboard.js';

export interface CategoryIssueItem {
  issue: GitHubIssue;
  status: TaskStatus;
  blockers?: number[];
  parentNumber?: number;
  worker?: WorkerItem;
}

interface CategoryIssuesViewProps {
  categoryTitle: string;
  issues: CategoryIssueItem[];
  selectedIndex: number;
  confirmAction?: { type: 'kill' | 'pause'; issueNumber: number } | null;
  statusMessage?: string;
  repository?: string;
}

export const CategoryIssuesView: React.FC<CategoryIssuesViewProps> = ({
  categoryTitle,
  issues,
  selectedIndex,
  confirmAction,
  statusMessage,
  repository,
}) => {
  const currentItem = issues[selectedIndex];

  const renderWorkerBadge = (item: CategoryIssueItem) => {
    if (item.worker) {
      if (item.worker.status === 'running') {
        return <Text color="cyan">⚡ active worker</Text>;
      }
      if (item.worker.status === 'paused_quota') {
        return <Text color="yellow">⏳ paused (quota)</Text>;
      }
      if (item.worker.status === 'waiting_feedback') {
        return <Text color="magenta">👀 in review</Text>;
      }
      return <Text color="cyan">{item.worker.status}</Text>;
    }

    switch (item.status) {
      case 'ready':
        return <Text color="green">🟢 ready</Text>;
      case 'waiting_feedback':
        return <Text color="yellow">👀 waiting review</Text>;
      case 'blocked':
        return <Text color="gray">🚫 blocked</Text>;
      default:
        return <Text color="gray">{item.status}</Text>;
    }
  };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* Header Banner */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text backgroundColor="cyan" color="black" bold>
            {` 📋 ISSUES: ${categoryTitle.toUpperCase()} `}
          </Text>
          {repository && <Text color="gray"> | Repo: {repository}</Text>}
          <Text color="gray"> | Total: {issues.length}</Text>
        </Box>
        <Text color="gray">
          Select an issue to inspect, pause/resume, kill and wipe worktree, or open in browser.
        </Text>
      </Box>

      {/* Confirmation Modal if active */}
      {confirmAction && confirmAction.type === 'kill' && (
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} marginBottom={1}>
          <Text bold color="red">
            {`⚠️ CONFIRM KILL & WIPE WORKTREE: Issue #${confirmAction.issueNumber}`}
          </Text>
          <Text color="white">
            This will terminate the runner subprocess, delete the git worktree on disk, and clear session state.
          </Text>
          <Text bold color="yellow">
            Press [y] to confirm and wipe, or [n] / [Esc] to cancel.
          </Text>
        </Box>
      )}

      {/* Status Message */}
      {statusMessage && (
        <Box marginBottom={1}>
          <Text color={statusMessage.startsWith('❌') ? 'red' : statusMessage.startsWith('✓') ? 'green' : 'yellow'}>
            {statusMessage}
          </Text>
        </Box>
      )}

      {/* Issues Table */}
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text bold color="white" underline>
          Issue Backlog:
        </Text>
        {issues.length === 0 ? (
          <Box marginTop={1}>
            <Text color="gray">  No issues found in this category.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            <Box flexDirection="row" marginBottom={0}>
              <Box width={10}>
                <Text bold color="cyan">Issue</Text>
              </Box>
              <Box width={38}>
                <Text bold color="cyan">Title</Text>
              </Box>
              <Box width={22}>
                <Text bold color="cyan">Status / Session</Text>
              </Box>
              <Box width={20}>
                <Text bold color="cyan">Assigned Worker</Text>
              </Box>
            </Box>

            {issues.slice(0, 10).map((item, index) => {
              const isSelected = index === selectedIndex;
              const prefix = isSelected ? '❯ ' : '  ';
              const issueStr = `${prefix}#${item.issue.number}`;
              const titleStr = item.issue.title.length > 34 ? `${item.issue.title.slice(0, 31)}...` : item.issue.title;
              const workerStr = item.worker ? item.worker.branchName : item.blockers && item.blockers.length > 0 ? `blocked by #${item.blockers.join(', #')}` : 'Unassigned';

              return (
                <Box key={item.issue.number} flexDirection="row">
                  <Box width={10}>
                    <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                      {issueStr}
                    </Text>
                  </Box>
                  <Box width={38}>
                    <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                      {titleStr}
                    </Text>
                  </Box>
                  <Box width={22}>
                    {renderWorkerBadge(item)}
                  </Box>
                  <Box width={20}>
                    <Text color="gray">
                      {workerStr.length > 18 ? `${workerStr.slice(0, 15)}...` : workerStr}
                    </Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Selected Item Details */}
      {currentItem && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
          <Text bold color="white">
            {`Issue #${currentItem.issue.number}: ${currentItem.issue.title}`}
          </Text>
          <Box flexDirection="row" marginTop={0}>
            <Text color="gray">Labels: </Text>
            <Text color="cyan">{currentItem.issue.labels.map((l) => l.name).join(', ') || 'none'}</Text>
          </Box>
          {currentItem.blockers && currentItem.blockers.length > 0 && (
            <Box flexDirection="row">
              <Text color="yellow">Blockers: </Text>
              <Text color="yellow">{currentItem.blockers.map((b) => `#${b}`).join(', ')}</Text>
            </Box>
          )}
          {currentItem.worker && (
            <Box flexDirection="row">
              <Text color="gray">Active Worktree: </Text>
              <Text color="white">{currentItem.worker.branchName} ({currentItem.worker.status})</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Footer Navigation */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">
          [p] Pause/Resume  •  [k] Kill &amp; Wipe  •  [o] Open in Browser  •  [Enter] Inspect Live Tail  •  [Esc] Back
        </Text>
      </Box>
    </Box>
  );
};
