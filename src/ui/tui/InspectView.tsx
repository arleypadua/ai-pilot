import React from 'react';
import { Box, Text } from 'ink';
import type { AgentEvent } from '../../events/bus.js';
import type { WorkerItem } from './MasterDashboard.js';

interface InspectViewProps {
  worker: WorkerItem;
  events: AgentEvent[];
  inputText: string;
  isSubmitting: boolean;
  statusMessage?: string;
}

export const InspectView: React.FC<InspectViewProps> = ({
  worker,
  events,
  inputText,
  isSubmitting,
  statusMessage,
}) => {
  const renderEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'tool_start':
        return (
          <Box key={event.id} flexDirection="row">
            <Text color="gray">[{event.timestamp}] </Text>
            <Text color="cyan">{event.summary}</Text>
          </Box>
        );
      case 'tool_end':
        return (
          <Box key={event.id} flexDirection="row">
            <Text color="gray">[{event.timestamp}] </Text>
            <Text color="green">{event.summary}</Text>
          </Box>
        );
      case 'thought':
        return (
          <Box key={event.id} flexDirection="row">
            <Text color="gray">[{event.timestamp}] </Text>
            <Text color="yellow">💬 {event.summary.length > 120 ? `${event.summary.slice(0, 117)}...` : event.summary}</Text>
          </Box>
        );
      case 'prompt_injected':
        return (
          <Box key={event.id} flexDirection="row">
            <Text color="gray">[{event.timestamp}] </Text>
            <Text color="magenta" bold>💡 {event.summary}</Text>
          </Box>
        );
      case 'stderr':
        return (
          <Box key={event.id} flexDirection="row">
            <Text color="gray">[{event.timestamp}] </Text>
            <Text color="red">⚠️ {event.summary}</Text>
          </Box>
        );
      case 'info':
        return (
          <Box key={event.id} flexDirection="row">
            <Text color="gray">[{event.timestamp}] </Text>
            <Text color="blue">ℹ️ {event.summary}</Text>
          </Box>
        );
      case 'stdout':
      default:
        return (
          <Box key={event.id} flexDirection="row">
            <Text color="gray">[{event.timestamp}] </Text>
            <Text color="white">{event.summary.length > 110 ? `${event.summary.slice(0, 107)}...` : event.summary}</Text>
          </Box>
        );
    }
  };

  const recentEvents = events.slice(-14);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* Header Banner */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text backgroundColor="cyan" color="black" bold>
            {` ⚡ LIVE TAIL: Issue #${worker.issueNumber} `}
          </Text>
          <Text bold color="white">
            {' '}{worker.title}
          </Text>
        </Box>
        <Box flexDirection="row" marginTop={0}>
          <Text color="gray">Branch: </Text>
          <Text color="white">{worker.branchName}  </Text>
          <Text color="gray">Status: </Text>
          <Text color="cyan">{worker.status}  </Text>
        </Box>
      </Box>

      {/* Live Activity Stream Viewport */}
      <Box flexDirection="column" height={16} marginBottom={1}>
        <Text bold color="white">
          Agent Activity &amp; Tool Calls:
        </Text>
        {recentEvents.length === 0 ? (
          <Box flexDirection="column" marginTop={1}>
            {worker.status === 'paused_quota' || worker.isWip ? (
              <>
                <Text color="yellow">  ⏳ Task execution is paused awaiting 5-hour quota reset (preserves WIP).</Text>
                <Text color="gray">  Worktree state &amp; code changes are intact. You can inject prompt guidance below.</Text>
              </>
            ) : (
              <Text color="gray">  Agent is initializing context and analyzing task...</Text>
            )}
          </Box>
        ) : (
          <Box flexDirection="column">
            {recentEvents.map(renderEvent)}
          </Box>
        )}
      </Box>

      {/* Prompt Injection Input Bar */}
      <Box flexDirection="column" borderStyle="single" borderColor={isSubmitting ? 'yellow' : 'cyan'} paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text bold color="cyan">
            {'❯ Inject prompt: '}
          </Text>
          <Text color="white">
            {inputText}
          </Text>
          <Text color="cyan" bold>
            _
          </Text>
        </Box>
        {statusMessage && (
          <Box marginTop={0}>
            <Text color="yellow">{statusMessage}</Text>
          </Box>
        )}
      </Box>

      {/* Footer Navigation Hints */}
      <Box paddingX={1}>
        <Text color="gray">
          [Esc] Back to Overview  •  [Enter] Send prompt
        </Text>
      </Box>
    </Box>
  );
};
