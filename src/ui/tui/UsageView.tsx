import React from 'react';
import { Box, Text } from 'ink';
import type { QuotaStatus } from '../../quota/monitor.js';

interface UsageViewProps {
  quotaStatus: QuotaStatus | null;
  repository?: string;
  isRefreshing?: boolean;
}

export const UsageView: React.FC<UsageViewProps> = ({
  quotaStatus,
  repository,
  isRefreshing = false,
}) => {
  const renderProgressBar = (pct: number, length: number = 24) => {
    const filled = Math.min(length, Math.max(0, Math.round((pct / 100) * length)));
    const empty = Math.max(0, length - filled);
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const color = pct >= 95 ? 'red' : pct >= 80 ? 'yellow' : 'green';
    return <Text color={color}>[{bar}] {pct}%</Text>;
  };

  const live = quotaStatus?.liveUsage;
  const rolling = quotaStatus?.rollingStats;
  const isPaused = Boolean(quotaStatus?.isPaused);
  const resetAt = quotaStatus?.resetAt;

  const remainingMins = resetAt
    ? Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / (60 * 1000)))
    : null;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* Header Banner */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text backgroundColor="cyan" color="black" bold>
            {' 📊 CLAUDE QUOTA & SCHEDULED WAKE-UP TELEMETRY '}
          </Text>
          {repository && (
            <Text color="gray"> | Repo: {repository}</Text>
          )}
        </Box>
        <Text color="gray">
          Live telemetry stream synced directly with Claude CLI (/usage)
        </Text>
      </Box>

      {/* 1. 5-Hour Session Quota */}
      <Box flexDirection="column" borderStyle="single" borderColor={isPaused ? 'red' : 'cyan'} paddingX={1} marginBottom={1}>
        <Text bold color="white">
          5-Hour Session Quota:
        </Text>
        {live ? (
          <Box flexDirection="column" marginTop={0}>
            <Box flexDirection="row">
              <Box width={32}>
                {renderProgressBar(live.sessionUsedPercentage, 20)}
              </Box>
              {live.sessionResetText && (
                <Text color="gray">Resets: {live.sessionResetText}</Text>
              )}
            </Box>
            {live.sessionResetAt && (
              <Text color="gray">Exact Reset Time: {live.sessionResetAt.toLocaleTimeString()} ({live.sessionResetAt.toLocaleDateString()})</Text>
            )}
          </Box>
        ) : rolling ? (
          <Box flexDirection="column" marginTop={0}>
            <Box flexDirection="row">
              <Box width={32}>
                {renderProgressBar(Math.round(rolling.utilization * 100), 20)}
              </Box>
              <Text color="gray">
                ({Math.round(rolling.totalOutputTokens / 1000)}k / {Math.round(rolling.estimatedCeiling / 1000)}k output tokens)
              </Text>
            </Box>
          </Box>
        ) : (
          <Text color="green">  ● Normal (Session healthy, ample headroom remaining)</Text>
        )}
      </Box>

      {/* 2. Weekly Quota */}
      {live && live.weekUsedPercentage !== undefined && (
        <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
          <Text bold color="white">
            Weekly Account Quota:
          </Text>
          <Box flexDirection="row">
            <Box width={32}>
              {renderProgressBar(live.weekUsedPercentage, 20)}
            </Box>
            {live.weekResetText && (
              <Text color="gray">Resets: {live.weekResetText}</Text>
            )}
          </Box>
        </Box>
      )}

      {/* 3. Scheduled Wake-Up & Daemon Pause Status */}
      <Box flexDirection="column" borderStyle="round" borderColor={isPaused ? 'yellow' : 'green'} paddingX={1} marginBottom={1}>
        <Text bold color={isPaused ? 'yellow' : 'green'}>
          {isPaused ? '⏳ SCHEDULED WAKE-UP STATUS (PAUSED)' : '✅ WAKE-UP STATUS (HEALTHY)'}
        </Text>
        {isPaused && resetAt ? (
          <Box flexDirection="column">
            <Text color="yellow" bold>
              Resumes at: {resetAt.toLocaleTimeString()} (~{remainingMins} min remaining)
            </Text>
            <Text color="gray">
              Reason: {quotaStatus?.reason || '5-hour rolling quota limit reached'}
            </Text>
            <Text color="gray">
              Action: Workers are suspended to preserve quota. Subprocesses will automatically wake up at reset time.
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text color="green">
              No pause scheduled. The daemon is actively processing issues up to max concurrency.
            </Text>
          </Box>
        )}
      </Box>

      {/* 4. Telemetry Metadata */}
      <Box flexDirection="row" marginBottom={1}>
        <Text color="gray">
          Last Synced: {live?.lastFetchedAt ? new Date(live.lastFetchedAt).toLocaleTimeString() : new Date().toLocaleTimeString()}
          {isRefreshing ? ' (refreshing...)' : ''}  •  Active PIDs: {quotaStatus?.activePids.length || 0}
        </Text>
      </Box>

      {/* Footer Navigation */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">
          [Esc] Back to Main Dashboard  •  [r] Refresh Telemetry
        </Text>
      </Box>
    </Box>
  );
};
