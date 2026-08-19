import React from 'react';
import { Box, Text } from 'ink';
import type { AutoPilotConfig, TaskStatus } from '../../types/index.js';
import type { IssueDAG } from '../../github/dag.js';
import type { QuotaStatus } from '../../quota/monitor.js';
import { CommandPalette, type CommandResult } from './CommandPalette.js';

export interface WorkerItem {
  issueNumber: number;
  title: string;
  branchName: string;
  status: TaskStatus;
  startedAt?: Date;
  isWip?: boolean;
}

interface MasterDashboardProps {
  config: AutoPilotConfig;
  dag: IssueDAG | null;
  quotaStatus: QuotaStatus | null;
  workers: WorkerItem[];
  selectedIndex: number;
  activityLogs: string[];
  commandInput?: string;
  isCommandMode?: boolean;
  commandResult?: CommandResult | null;
  selectedCommandIndex?: number;
  isSessionStarted?: boolean;
}

export const MasterDashboard: React.FC<MasterDashboardProps> = ({
  config,
  dag,
  quotaStatus,
  workers,
  selectedIndex,
  activityLogs,
  commandInput = '',
  isCommandMode = false,
  commandResult = null,
  selectedCommandIndex = 0,
  isSessionStarted = true,
}) => {
  const targetSpecs = dag ? dag.getTargetSpecs() : [];
  let specContext = '';
  if (targetSpecs.length === 1) {
    specContext = ` | Spec: #${targetSpecs[0]}`;
  } else if (targetSpecs.length > 1) {
    specContext = ` | Specs: ${targetSpecs.map((s) => `#${s}`).join(', ')}`;
  } else {
    specContext = ` | Scope: Any Spec (All Tasks)`;
  }
  const repoContext = config.repository ? ` | Repo: ${config.repository}` : '';

  const renderQuotaBar = () => {
    if (!quotaStatus) {
      return <Text color="green">● Quota Status: Normal</Text>;
    }

    if (quotaStatus.isPaused && quotaStatus.resetAt) {
      const remainingMs = Math.max(0, quotaStatus.resetAt.getTime() - Date.now());
      const remainingMins = Math.ceil(remainingMs / (60 * 1000));
      return (
        <Box flexDirection="column">
          <Text backgroundColor="red" color="white" bold>
            {' ⏳ 5-HOUR QUOTA PAUSED '}
          </Text>
          <Text color="red">
            Resumes at {quotaStatus.resetAt.toLocaleTimeString()} (~{remainingMins} min remaining)
          </Text>
        </Box>
      );
    }

    if (quotaStatus.liveUsage) {
      const live = quotaStatus.liveUsage;
      const sessPct = live.sessionUsedPercentage;
      const barLen = 12;
      const sessFilled = Math.min(barLen, Math.max(0, Math.round((sessPct / 100) * barLen)));
      const sessBar = '█'.repeat(sessFilled) + '░'.repeat(Math.max(0, barLen - sessFilled));
      const sessColor = sessPct >= 100 ? 'red' : sessPct >= 80 ? 'yellow' : 'green';

      return (
        <Box flexDirection="column">
          <Text color={sessColor}>
            ● 5h Session Quota: [{sessBar}] {sessPct}% used
            {live.sessionResetText ? ` · Resets ${live.sessionResetText}` : ''}
          </Text>
          {live.weekUsedPercentage !== undefined && (
            <Text color={live.weekUsedPercentage >= 90 ? 'red' : 'cyan'}>
              ● Weekly Quota:    [{'█'.repeat(Math.min(12, Math.round((live.weekUsedPercentage / 100) * 12))) + '░'.repeat(Math.max(0, 12 - Math.round((live.weekUsedPercentage / 100) * 12)))}] {live.weekUsedPercentage}% used
            </Text>
          )}
        </Box>
      );
    }

    if (quotaStatus.rollingStats) {
      const stats = quotaStatus.rollingStats;
      const pct = Math.round(stats.utilization * 100);
      const usedK = Math.round(stats.totalOutputTokens / 1000);
      const capK = Math.round(stats.estimatedCeiling / 1000);
      const barLen = 12;
      const filled = Math.min(barLen, Math.max(0, Math.round((pct / 100) * barLen)));
      const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barLen - filled));
      const meterColor = pct >= 85 ? 'red' : pct >= 70 ? 'yellow' : 'green';

      return (
        <Text color={meterColor}>
          ● 5h Rolling Quota: [{bar}] {pct}% ({usedK}k / {capK}k output tokens)
        </Text>
      );
    }

    return <Text color="green">● Quota Status: Normal (5h window healthy)</Text>;
  };

  const renderStatusBadge = (worker: WorkerItem) => {
    if (worker.isWip) {
      if (worker.status === 'paused_quota') {
        return <Text color="yellow">⏳ paused (quota)</Text>;
      }
      if (worker.status === 'waiting_feedback') {
        return <Text color="magenta">👀 in review</Text>;
      }
      if (worker.status === 'blocked') {
        return <Text color="gray">⏳ blocked</Text>;
      }
      return <Text color="cyan">⏳ waiting (WIP)</Text>;
    }
    switch (worker.status) {
      case 'running':
        return <Text color="cyan">⚡ running</Text>;
      case 'testing':
        return <Text color="magenta">🧪 testing</Text>;
      case 'merging':
        return <Text color="yellow">🔀 merging</Text>;
      case 'paused_quota':
        return <Text color="red">⏳ paused</Text>;
      case 'waiting_feedback':
        return <Text color="yellow">👀 in review</Text>;
      default:
        return <Text color="gray">{worker.status}</Text>;
    }
  };

  const renderElapsed = (worker: WorkerItem) => {
    if (worker.isWip) {
      return <Text color="gray">preserves WIP</Text>;
    }
    if (!worker.startedAt) return <Text color="gray">-</Text>;
    const sec = Math.floor((Date.now() - worker.startedAt.getTime()) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return <Text color="gray">{m}m {s}s</Text>;
  };

  const readyNodes = dag ? dag.getReadyNodes() : [];
  const waitingNodes = dag ? dag.getWaitingFeedbackNodes() : [];
  const blockedNodes = dag ? dag.getBlockedNodes() : [];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* Header Banner */}
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row">
          <Text backgroundColor="cyan" color="black" bold>
            {' ⚡ AGENT AUTO-PILOT '}
          </Text>
          <Text color="cyan">
            {repoContext}{specContext}
          </Text>
        </Box>
        <Text color="gray">
          Runner: {config.runner} (/implement) | Concurrency: {workers.filter((w) => !w.isWip).length}/{config.maxConcurrency}
        </Text>
      </Box>

      {/* Quota Telemetry */}
      <Box marginBottom={1}>
        {renderQuotaBar()}
      </Box>

      {/* Worker Selection Table */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">
          Active &amp; Paused Agent Worktrees:
        </Text>
        {workers.length === 0 ? (
          <Text color="gray">  No active agent workers running (Idle)</Text>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="row" marginBottom={0}>
              <Box width={10}>
                <Text bold color="cyan">Issue</Text>
              </Box>
              <Box width={32}>
                <Text bold color="cyan">Title</Text>
              </Box>
              <Box width={26}>
                <Text bold color="cyan">Branch</Text>
              </Box>
              <Box width={18}>
                <Text bold color="cyan">Status</Text>
              </Box>
              <Box width={16}>
                <Text bold color="cyan">Elapsed</Text>
              </Box>
            </Box>
            {workers.map((worker, index) => {
              const isSelected = index === selectedIndex;
              const prefix = isSelected ? '❯ ' : '  ';
              const issueStr = `${prefix}#${worker.issueNumber}`;
              const titleStr = worker.title.length > 28 ? `${worker.title.slice(0, 25)}...` : worker.title;
              const branchStr = worker.branchName.length > 24 ? `${worker.branchName.slice(0, 21)}...` : worker.branchName;

              return (
                <Box key={worker.issueNumber} flexDirection="row">
                  <Box width={10}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {issueStr}
                    </Text>
                  </Box>
                  <Box width={32}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {titleStr}
                    </Text>
                  </Box>
                  <Box width={26}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {branchStr}
                    </Text>
                  </Box>
                  <Box width={18}>
                    {renderStatusBadge(worker)}
                  </Box>
                  <Box width={16}>
                    {renderElapsed(worker)}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* DAG Queue Summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row">
          <Text bold color="white">
            Issue DAG Queue:
          </Text>
          <Text color="gray"> (highlight &amp; press [Enter] to inspect issues)</Text>
        </Box>

        {/* 1. Scoped Specs / All Specs Row */}
        <Box flexDirection="row">
          <Box width={26}>
            <Text
              color={selectedIndex === workers.length ? 'cyan' : 'cyan'}
              bold={selectedIndex === workers.length}
            >
              {selectedIndex === workers.length ? '❯ ' : '  '}
              {targetSpecs.length > 0 ? '🎯 Scoped Specs:' : '🎯 All Specs (Any):'}
            </Text>
          </Box>
          <Box width={6}>
            <Text bold color={selectedIndex === workers.length ? 'cyan' : 'white'}>
              {targetSpecs.length > 0 ? targetSpecs.length : 'All'}
            </Text>
          </Box>
          <Text color={selectedIndex === workers.length ? 'cyan' : 'gray'}>
            {targetSpecs.length > 0 ? targetSpecs.map((s) => `#${s}`).join(', ') : 'Resolving all ready tasks'}
          </Text>
        </Box>

        {/* 2. Ready for Agent Row */}
        <Box flexDirection="row">
          <Box width={26}>
            <Text
              color={selectedIndex === workers.length + 1 ? 'cyan' : 'green'}
              bold={selectedIndex === workers.length + 1}
            >
              {selectedIndex === workers.length + 1 ? '❯ ' : '  '}🟢 Ready for Agent:
            </Text>
          </Box>
          <Box width={6}>
            <Text bold color={selectedIndex === workers.length + 1 ? 'cyan' : 'green'}>
              {readyNodes.length}
            </Text>
          </Box>
          <Text color={selectedIndex === workers.length + 1 ? 'cyan' : 'gray'}>
            {readyNodes.map((n) => `#${n.issue.number}`).join(', ') || 'None'}
          </Text>
        </Box>

        {/* 3. Waiting Feedback Row */}
        <Box flexDirection="row">
          <Box width={26}>
            <Text
              color={selectedIndex === workers.length + 2 ? 'cyan' : 'yellow'}
              bold={selectedIndex === workers.length + 2}
            >
              {selectedIndex === workers.length + 2 ? '❯ ' : '  '}🟡 Waiting Feedback:
            </Text>
          </Box>
          <Box width={6}>
            <Text bold color={selectedIndex === workers.length + 2 ? 'cyan' : 'yellow'}>
              {waitingNodes.length}
            </Text>
          </Box>
          <Text color={selectedIndex === workers.length + 2 ? 'cyan' : 'gray'}>
            {waitingNodes.map((n) => `#${n.issue.number}`).join(', ') || 'None'}
          </Text>
        </Box>

        {/* 4. Blocked by Deps Row */}
        <Box flexDirection="row">
          <Box width={26}>
            <Text
              color={selectedIndex === workers.length + 3 ? 'cyan' : 'gray'}
              bold={selectedIndex === workers.length + 3}
            >
              {selectedIndex === workers.length + 3 ? '❯ ' : '  '}⚪ Blocked by Deps:
            </Text>
          </Box>
          <Box width={6}>
            <Text bold color={selectedIndex === workers.length + 3 ? 'cyan' : 'gray'}>
              {blockedNodes.length}
            </Text>
          </Box>
          <Text color={selectedIndex === workers.length + 3 ? 'cyan' : 'gray'}>
            {blockedNodes.map((n) => `#${n.issue.number} (blocked by ${n.blockers.join(', ')})`).join(', ') || 'None'}
          </Text>
        </Box>
      </Box>

      {/* Recent Activity Snapshot (Strictly capped to 3 single-line entries) */}
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row">
          <Text
            bold={selectedIndex === workers.length + 4}
            color={selectedIndex === workers.length + 4 ? 'cyan' : 'white'}
          >
            {selectedIndex === workers.length + 4 ? '❯ ' : '  '}📜 Recent Activity:
          </Text>
          <Text color={selectedIndex === workers.length + 4 ? 'cyan' : 'gray'}>
            {' '}(press [Enter] or type /logs for full log history)
          </Text>
        </Box>
        {activityLogs.length === 0 ? (
          <Text color="gray">  Waiting for events...</Text>
        ) : (
          activityLogs.slice(-3).map((line, idx) => {
            const truncated = line.length > 90 ? `${line.slice(0, 87)}...` : line;
            return (
              <Text key={idx} color="gray">
                {'  '}{truncated}
              </Text>
            );
          })
        )}
      </Box>

      {/* Command Palette & Footer */}
      <CommandPalette
        commandInput={commandInput}
        isCommandMode={isCommandMode}
        commandResult={commandResult}
        selectedCommandIndex={selectedCommandIndex}
      />
    </Box>
  );
};
