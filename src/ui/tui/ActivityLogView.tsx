import React from 'react';
import { Box, Text } from 'ink';

interface ActivityLogViewProps {
  logs: string[];
  repository?: string;
  scrollOffset?: number;
}

export const ActivityLogView: React.FC<ActivityLogViewProps> = ({
  logs,
  repository,
  scrollOffset = 0,
}) => {
  const pageSize = 16;
  const maxScroll = Math.max(0, logs.length - pageSize);
  const effectiveScroll = Math.min(maxScroll, Math.max(0, scrollOffset));
  const visibleLogs = logs.slice(effectiveScroll, effectiveScroll + pageSize);

  const renderLogLine = (line: string, index: number) => {
    let color: string = 'white';
    if (line.includes('❌') || line.includes('error') || line.includes('Error') || line.includes('Failed')) {
      color = 'red';
    } else if (line.includes('⏳') || line.includes('Quota') || line.includes('paused') || line.includes('Suspended')) {
      color = 'yellow';
    } else if (line.includes('✓') || line.includes('COMPLETE') || line.includes('🎉') || line.includes('Started')) {
      color = 'green';
    } else if (line.includes('Dispatched') || line.includes('allocated')) {
      color = 'cyan';
    }

    return (
      <Box key={`${effectiveScroll + index}-${line.slice(0, 20)}`} flexDirection="row">
        <Text color={color}>{line}</Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* Header Banner */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text backgroundColor="cyan" color="black" bold>
            {' 📜 SYSTEM & DAEMON ACTIVITY LOGS '}
          </Text>
          {repository && <Text color="gray"> | Repo: {repository}</Text>}
          <Text color="gray"> | Total Events: {logs.length}</Text>
        </Box>
        <Text color="gray">
          Chronological activity stream of background orchestrator events, ticks, and state changes.
        </Text>
      </Box>

      {/* Log Stream Viewport */}
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} height={18} marginBottom={1}>
        {visibleLogs.length === 0 ? (
          <Box marginTop={1}>
            <Text color="gray">  No activity logs recorded yet.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {visibleLogs.map(renderLogLine)}
          </Box>
        )}
      </Box>

      {/* Footer Navigation */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">
          [Esc] Back to Main Dashboard  •  [↑/↓ or j/k] Scroll ({effectiveScroll + 1}-{Math.min(logs.length, effectiveScroll + pageSize)} of {logs.length})  •  [c] Clear Logs
        </Text>
      </Box>
    </Box>
  );
};
