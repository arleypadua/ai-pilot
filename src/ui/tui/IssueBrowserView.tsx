import React from 'react';
import { Box, Text } from 'ink';
import type { GitHubIssue, TaskStatus } from '../../types/index.js';
import type { WorkerItem } from './MasterDashboard.js';

export interface TreeSpecItem {
  type: 'spec';
  number: number;
  title: string;
  status: TaskStatus;
  isComplete: boolean;
  totalTickets: number;
  completedTickets: number;
  isExpanded: boolean;
  worker?: WorkerItem;
  blockers?: number[];
  labels?: string[];
  issue: GitHubIssue;
}

export interface TreeChildItem {
  type: 'child';
  number: number;
  title: string;
  status: TaskStatus;
  state: string;
  isClosed: boolean;
  parentSpecNumber: number;
  isLast: boolean;
  worker?: WorkerItem;
  blockers?: number[];
  labels?: string[];
  issue?: GitHubIssue;
}

export interface TreeStandaloneItem {
  type: 'standalone';
  number: number;
  title: string;
  status: TaskStatus;
  worker?: WorkerItem;
  blockers?: number[];
  labels?: string[];
  issue: GitHubIssue;
}

export type FlatTreeItem = TreeSpecItem | TreeChildItem | TreeStandaloneItem;

interface IssueBrowserViewProps {
  items: FlatTreeItem[];
  selectedIndex: number;
  confirmAction?: { type: 'kill' | 'pause' | 'enqueue'; issueNumber: number; message?: string } | null;
  statusMessage?: string;
  repository?: string;
  totalSpecsCount: number;
  totalStandaloneCount: number;
  showOnlyOpen?: boolean;
}

export const IssueBrowserView: React.FC<IssueBrowserViewProps> = ({
  items,
  selectedIndex,
  confirmAction,
  statusMessage,
  repository,
  totalSpecsCount,
  totalStandaloneCount,
  showOnlyOpen = false,
}) => {
  const currentItem = items[selectedIndex];

  const renderStatusBadge = (item: FlatTreeItem) => {
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

    if (item.type === 'child' && (item.isClosed || item.state === 'CLOSED')) {
      return <Text color="gray">✔ closed</Text>;
    }

    switch (item.status) {
      case 'ready':
        return <Text color="green">🟢 ready</Text>;
      case 'waiting_feedback': {
        const labels = item.labels?.map((l) => l.toLowerCase()) || [];
        const isNeedsInfo = labels.includes('needs-info');
        const isHumanTask = labels.some(
          (l) => l === 'ready-for-human' || l === 'human-task' || l === 'human-tasks' || l === 'human_task' || l === 'human'
        );
        if (isNeedsInfo) {
          return <Text color="yellow">❓ needs info</Text>;
        }
        if (isHumanTask) {
          return <Text color="magenta">👤 human task</Text>;
        }
        return <Text color="yellow">👀 in review</Text>;
      }
      case 'blocked':
        return <Text color="gray">🚫 blocked</Text>;
      case 'completed':
        return <Text color="gray">✔ closed</Text>;
      default:
        return <Text color="gray">⚪ {item.status}</Text>;
    }
  };

  const PAGE_SIZE = 11;
  let startIndex = 0;
  if (items.length > PAGE_SIZE) {
    if (selectedIndex < Math.floor(PAGE_SIZE / 2)) {
      startIndex = 0;
    } else if (selectedIndex >= items.length - Math.floor(PAGE_SIZE / 2)) {
      startIndex = Math.max(0, items.length - PAGE_SIZE);
    } else {
      startIndex = selectedIndex - Math.floor(PAGE_SIZE / 2);
    }
  }
  const endIndex = Math.min(items.length, startIndex + PAGE_SIZE);
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* Header Banner */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text backgroundColor="cyan" color="black" bold>
            {' 🌳 ISSUE TREE BROWSER '}
          </Text>
          {repository && <Text color="gray"> | Repo: {repository}</Text>}
        </Box>
        <Box flexDirection="row" marginTop={0}>
          <Text color="gray">{`Specs: ${totalSpecsCount}  •  Standalone: ${totalStandaloneCount}  •  Rows: ${items.length}  •  `}</Text>
          <Text color={showOnlyOpen ? 'yellow' : 'cyan'}>
            {`Filter: ${showOnlyOpen ? 'Open Only' : 'All Tasks'}`}
          </Text>
        </Box>
        <Text color="gray">
          Browse hierarchy of open specs, subtasks, and standalone issues. Expand/collapse specs or inspect live tail.
        </Text>
      </Box>

      {/* Confirmation Modals */}
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

      {confirmAction && confirmAction.type === 'enqueue' && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
          <Text bold color="yellow">
            {`⚠️ CONFIRM PRIORITY ENQUEUE: Issue #${confirmAction.issueNumber}`}
          </Text>
          <Text color="white">
            {confirmAction.message || `Issue #${confirmAction.issueNumber} will be placed into the priority queue.`}
          </Text>
          <Text bold color="cyan">
            Press [y] to confirm and enqueue, or [n] / [Esc] to cancel.
          </Text>
        </Box>
      )}

      {/* Status Notification Message */}
      {statusMessage && (
        <Box marginBottom={1}>
          <Text color={statusMessage.startsWith('❌') ? 'red' : statusMessage.startsWith('✓') ? 'green' : 'yellow'}>
            {statusMessage}
          </Text>
        </Box>
      )}

      {/* Tree Table */}
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text bold color="white" underline>
          Issue Tree Hierarchy:
        </Text>

        {items.length === 0 ? (
          <Box marginTop={1}>
            <Text color="gray">  No open issues or specifications found in repository.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {/* Table Column Headers */}
            <Box flexDirection="row" marginBottom={0}>
              <Box width={48}>
                <Text bold color="cyan">Issue Tree Node</Text>
              </Box>
              <Box width={20}>
                <Text bold color="cyan">Status</Text>
              </Box>
              <Box width={24}>
                <Text bold color="cyan">Worker / Dependencies</Text>
              </Box>
            </Box>

            {/* Tree Rows */}
            {visibleItems.map((item, localIndex) => {
              const actualIndex = startIndex + localIndex;
              const isSelected = actualIndex === selectedIndex;
              const cursor = isSelected ? '❯ ' : '  ';

              let labelNode: React.ReactNode = null;
              let workerStr = 'Unassigned';

              if (item.worker) {
                workerStr = item.worker.branchName;
              } else if (item.blockers && item.blockers.length > 0) {
                workerStr = `blocked by #${item.blockers.join(', #')}`;
              }

              if (item.type === 'spec') {
                const icon = item.isExpanded ? '▼' : '▶';
                const progress = item.totalTickets > 0 ? ` [${item.completedTickets}/${item.totalTickets}]` : '';
                const titleStr = item.title.length > 24 ? `${item.title.slice(0, 21)}...` : item.title;
                labelNode = (
                  <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                    {`${cursor}${icon} [Spec #${item.number}] ${titleStr}${progress}`}
                  </Text>
                );
              } else if (item.type === 'child') {
                const connector = item.isLast ? '└── ' : '├── ';
                const titleStr = item.title.length > 26 ? `${item.title.slice(0, 23)}...` : item.title;
                const isClosed = item.isClosed || item.state === 'CLOSED';
                labelNode = (
                  <Text color={isSelected ? 'cyan' : isClosed ? 'gray' : 'white'} bold={isSelected}>
                    {`${cursor}    ${connector}#${item.number} ${titleStr}`}
                  </Text>
                );
              } else {
                // Standalone ticket
                const titleStr = item.title.length > 30 ? `${item.title.slice(0, 27)}...` : item.title;
                labelNode = (
                  <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                    {`${cursor}● #${item.number} ${titleStr}`}
                  </Text>
                );
              }

              return (
                <Box key={`${item.type}-${item.number}`} flexDirection="row">
                  <Box width={48}>
                    {labelNode}
                  </Box>
                  <Box width={20}>
                    {renderStatusBadge(item)}
                  </Box>
                  <Box width={24}>
                    <Text color="gray">
                      {workerStr.length > 22 ? `${workerStr.slice(0, 19)}...` : workerStr}
                    </Text>
                  </Box>
                </Box>
              );
            })}

            {items.length > PAGE_SIZE && (
              <Box marginTop={1} flexDirection="row">
                <Text color="gray">
                  Showing {startIndex + 1}–{endIndex} of {items.length} rows (use [↑/↓] or [j/k] to navigate)
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* Selected Item Details Box */}
      {currentItem && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
          <Box flexDirection="row">
            <Text bold color="white">
              {currentItem.type === 'spec'
                ? `Specification #${currentItem.number}: ${currentItem.title}`
                : currentItem.type === 'child'
                ? `Subtask #${currentItem.number}: ${currentItem.title} (Parent Spec: #${currentItem.parentSpecNumber})`
                : `Standalone Issue #${currentItem.number}: ${currentItem.title}`}
            </Text>
          </Box>

          <Box flexDirection="row" marginTop={0}>
            <Text color="gray">Labels: </Text>
            <Text color="cyan">{currentItem.labels?.join(', ') || 'none'}</Text>
          </Box>

          {currentItem.type === 'spec' && currentItem.totalTickets > 0 && (
            <Box flexDirection="row">
              <Text color="gray">Spec Progress: </Text>
              <Text color="white">
                {`${currentItem.completedTickets} of ${currentItem.totalTickets} child tickets completed (${Math.round(
                  (currentItem.completedTickets / currentItem.totalTickets) * 100
                )}%)`}
              </Text>
            </Box>
          )}

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

      {/* Footer Navigation Bar */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">
          [Space/←/→] Expand  •  [a] Expand All  •  [c] {showOnlyOpen ? 'Show All' : 'Open Only'}  •  [e] Enqueue  •  [Enter/i] Live Tail  •  [o] Browser  •  [p] Pause  •  [k] Kill  •  [Esc] Back
        </Text>
      </Box>
    </Box>
  );
};
