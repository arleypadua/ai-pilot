import React from 'react';
import { Box, Text } from 'ink';
import type { GitHubIssue, TaskStatus } from '../../types/index.js';
import type { WorkerItem } from './MasterDashboard.js';

export interface SpecOption {
  number?: number;
  title: string;
  childCount?: number;
  completedCount?: number;
  isAllTasks?: boolean;
  worker?: WorkerItem;
  blockers?: number[];
  labels?: string[];
  status?: TaskStatus;
  issue?: GitHubIssue;
}

interface SpecPickerViewProps {
  options: SpecOption[];
  highlightedIndex: number;
  selectedNumbers: Set<number>;
  isAllTasksSelected: boolean;
  confirmAction?: { type: 'kill' | 'pause'; issueNumber: number } | null;
  statusMessage?: string;
  repository?: string;
}

export const SpecPickerView: React.FC<SpecPickerViewProps> = ({
  options,
  highlightedIndex,
  selectedNumbers,
  isAllTasksSelected,
  confirmAction,
  statusMessage,
  repository,
}) => {
  const currentOpt = options[highlightedIndex];
  const selectedCount = selectedNumbers.size;
  let summaryText = '';
  if (isAllTasksSelected) {
    summaryText = '✨ Any unblocked task (all ready-for-agent issues)';
  } else if (selectedCount === 0) {
    summaryText = 'None selected (Press [Space] to select specs or [a] for Any)';
  } else if (selectedCount === 1) {
    const num = Array.from(selectedNumbers)[0];
    summaryText = `Spec #${num}`;
  } else {
    const list = Array.from(selectedNumbers).map((n) => `#${n}`).join(', ');
    summaryText = `${selectedCount} specs selected (${list})`;
  }

  const PAGE_SIZE = 10;
  let startIndex = 0;
  if (options.length > PAGE_SIZE) {
    if (highlightedIndex < Math.floor(PAGE_SIZE / 2)) {
      startIndex = 0;
    } else if (highlightedIndex >= options.length - Math.floor(PAGE_SIZE / 2)) {
      startIndex = Math.max(0, options.length - PAGE_SIZE);
    } else {
      startIndex = highlightedIndex - Math.floor(PAGE_SIZE / 2);
    }
  }
  const endIndex = Math.min(options.length, startIndex + PAGE_SIZE);
  const visibleOptions = options.slice(startIndex, endIndex);

  const renderWorkerBadge = (opt: SpecOption) => {
    if (opt.worker) {
      if (opt.worker.status === 'running') {
        return <Text color="cyan">⚡ active worker</Text>;
      }
      if (opt.worker.status === 'paused_quota') {
        return <Text color="yellow">⏳ paused (quota)</Text>;
      }
      if (opt.worker.status === 'waiting_feedback') {
        return <Text color="magenta">👀 in review</Text>;
      }
      return <Text color="cyan">{opt.worker.status}</Text>;
    }

    if (opt.isAllTasks) {
      return <Text color="green">✨ all tasks</Text>;
    }

    switch (opt.status) {
      case 'ready':
        return <Text color="green">🟢 ready</Text>;
      case 'waiting_feedback':
        return <Text color="yellow">👀 waiting review</Text>;
      case 'blocked':
        return <Text color="gray">🚫 blocked</Text>;
      case 'completed':
        return <Text color="green">✓ complete</Text>;
      default:
        return <Text color="gray">{opt.status || 'open'}</Text>;
    }
  };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* Header Banner */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text backgroundColor="cyan" color="black" bold>
            {' 🎯 SPECIFICATIONS & SCOPE SELECTOR '}
          </Text>
          {repository && <Text color="gray"> | Repo: {repository}</Text>}
          <Text color="gray"> | Total Specs: {options.filter((o) => !o.isAllTasks).length}</Text>
        </Box>
        <Text color="gray">
          Select specs with [Space], or choose Any unblocked task. Actions: [o] Open, [p] Pause/Resume, [x/k] Kill &amp; Wipe, [i] Inspect.
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

      {/* Options List */}
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text bold color="white" underline>
          Specifications Backlog &amp; Execution Scope:
        </Text>

        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row" marginBottom={0}>
            <Box width={14}>
              <Text bold color="cyan">Scope / Spec</Text>
            </Box>
            <Box width={34}>
              <Text bold color="cyan">Title</Text>
            </Box>
            <Box width={20}>
              <Text bold color="cyan">Sub-tasks</Text>
            </Box>
            <Box width={20}>
              <Text bold color="cyan">Worker / Status</Text>
            </Box>
          </Box>

          {visibleOptions.map((opt, localIndex) => {
            const actualIndex = startIndex + localIndex;
            const isHighlighted = actualIndex === highlightedIndex;
            const prefix = isHighlighted ? '❯ ' : '  ';

            if (opt.isAllTasks) {
              const isChecked = isAllTasksSelected;
              const checkmark = isChecked ? '[x] ' : '[ ] ';

              return (
                <Box key="all-tasks" flexDirection="row">
                  <Box width={14}>
                    <Text color={isHighlighted ? 'cyan' : isChecked ? 'green' : 'gray'} bold={isHighlighted || isChecked}>
                      {prefix}{checkmark}All
                    </Text>
                  </Box>
                  <Box width={34}>
                    <Text color={isHighlighted ? 'cyan' : isChecked ? 'green' : 'white'} bold={isHighlighted || isChecked}>
                      ✨ {opt.title.length > 30 ? `${opt.title.slice(0, 27)}...` : opt.title}
                    </Text>
                  </Box>
                  <Box width={20}>
                    <Text color="gray">all ready tasks</Text>
                  </Box>
                  <Box width={20}>
                    {renderWorkerBadge(opt)}
                  </Box>
                </Box>
              );
            }

            const isChecked = !isAllTasksSelected && opt.number !== undefined && selectedNumbers.has(opt.number);
            const checkmark = isChecked ? '[x] ' : '[ ] ';
            const specStr = `${prefix}${checkmark}#${opt.number}`;
            const titleStr = opt.title.length > 30 ? `${opt.title.slice(0, 27)}...` : opt.title;
            const progressStr =
              opt.childCount !== undefined
                ? `${opt.completedCount || 0}/${opt.childCount} completed`
                : '0 sub-tasks';

            return (
              <Box key={opt.number} flexDirection="row">
                <Box width={14}>
                  <Text color={isHighlighted ? 'cyan' : isChecked ? 'cyan' : 'white'} bold={isHighlighted || isChecked}>
                    {specStr}
                  </Text>
                </Box>
                <Box width={34}>
                  <Text color={isHighlighted ? 'cyan' : isChecked ? 'cyan' : 'white'} bold={isHighlighted || isChecked}>
                    {titleStr}
                  </Text>
                </Box>
                <Box width={20}>
                  <Text color="gray">{progressStr}</Text>
                </Box>
                <Box width={20}>
                  {renderWorkerBadge(opt)}
                </Box>
              </Box>
            );
          })}

          {options.length > PAGE_SIZE && (
            <Box marginTop={1} flexDirection="row">
              <Text color="gray">
                Showing {startIndex + 1}–{endIndex} of {options.length} options (use [↑/↓] or [j/k] to scroll)
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Selected Spec Details */}
      {currentOpt && currentOpt.number !== undefined && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
          <Text bold color="white">
            {`Spec #${currentOpt.number}: ${currentOpt.title}`}
          </Text>
          <Box flexDirection="row" marginTop={0}>
            <Text color="gray">Sub-tasks: </Text>
            <Text color="white">
              {currentOpt.completedCount || 0} of {currentOpt.childCount || 0} completed
            </Text>
            {currentOpt.labels && currentOpt.labels.length > 0 && (
              <>
                <Text color="gray">  | Labels: </Text>
                <Text color="cyan">{currentOpt.labels.join(', ')}</Text>
              </>
            )}
          </Box>
          {currentOpt.blockers && currentOpt.blockers.length > 0 && (
            <Box flexDirection="row">
              <Text color="yellow">Blockers: </Text>
              <Text color="yellow">{currentOpt.blockers.map((b) => `#${b}`).join(', ')}</Text>
            </Box>
          )}
          {currentOpt.worker && (
            <Box flexDirection="row">
              <Text color="gray">Active Worktree: </Text>
              <Text color="white">{currentOpt.worker.branchName} ({currentOpt.worker.status})</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Selected Summary */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
        <Text color="gray">Current Scope: </Text>
        <Text bold color={isAllTasksSelected || selectedCount > 0 ? 'cyan' : 'yellow'}>
          {summaryText}
        </Text>
      </Box>

      {/* Footer Navigation Hints */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">
          [Space] Toggle Scope  •  [a] Any  •  [o] Open Browser  •  [p] Pause/Resume  •  [x/k] Kill &amp; Wipe  •  [i] Inspect  •  [Enter] Apply Scope  •  [Esc] Back
        </Text>
      </Box>
    </Box>
  );
};
