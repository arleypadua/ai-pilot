import React from 'react';
import { Box, Text } from 'ink';
import type { ProviderInfo } from '../../types/index.js';

export interface ProvidersPickerViewProps {
  providers: ProviderInfo[];
  highlightedIndex: number;
  statusMessage?: string;
  repository?: string;
  configPath?: string;
}

export const ProvidersPickerView: React.FC<ProvidersPickerViewProps> = ({
  providers,
  highlightedIndex,
  statusMessage,
  repository,
  configPath = '.autopilot/config.json',
}) => {
  const currentProvider = providers[highlightedIndex];
  const allowedProviders = providers.filter((p) => p.isAllowed);
  const defaultProvider = providers.find((p) => p.isDefault);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* Header Banner */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text backgroundColor="cyan" color="black" bold>
            {' 🔌 LLM PROVIDERS & RUNNERS MANAGER '}
          </Text>
          {repository && <Text color="gray"> | Repo: {repository}</Text>}
          <Text color="gray"> | Config: {configPath}</Text>
        </Box>
        <Text color="gray">
          Toggle allowed providers for this repository. Disabled providers will not be used for task execution.
        </Text>
      </Box>

      {/* Status Message */}
      {statusMessage && (
        <Box marginBottom={1}>
          <Text color={statusMessage.startsWith('❌') ? 'red' : statusMessage.startsWith('✓') ? 'green' : 'yellow'}>
            {statusMessage}
          </Text>
        </Box>
      )}

      {/* Warning if no providers allowed */}
      {allowedProviders.length === 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
          <Text bold color="yellow">
            ⚠️ No providers are currently allowed for this repository.
          </Text>
          <Text color="gray">
            Tasks will be queued but cannot be executed until at least one provider is toggled on.
          </Text>
        </Box>
      )}

      {/* Providers Table */}
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text bold color="white" underline>
          Configured LLM Runners &amp; Providers:
        </Text>

        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row" marginBottom={0}>
            <Box width={12}>
              <Text bold color="cyan">Allowed</Text>
            </Box>
            <Box width={30}>
              <Text bold color="cyan">Provider</Text>
            </Box>
            <Box width={18}>
              <Text bold color="cyan">Status</Text>
            </Box>
            <Box width={18}>
              <Text bold color="cyan">Role</Text>
            </Box>
            <Box width={26}>
              <Text bold color="cyan">Description</Text>
            </Box>
          </Box>

          {providers.map((provider, index) => {
            const isHighlighted = index === highlightedIndex;
            const prefix = isHighlighted ? '❯ ' : '  ';
            const checkmark = provider.isAllowed ? '[x] ' : '[ ] ';
            const allowedColor = isHighlighted ? 'cyan' : provider.isAllowed ? 'green' : 'gray';

            return (
              <Box key={provider.id} flexDirection="row">
                <Box width={12}>
                  <Text color={allowedColor} bold={isHighlighted || provider.isAllowed}>
                    {prefix}{checkmark}{provider.isAllowed ? 'Yes' : 'No'}
                  </Text>
                </Box>
                <Box width={30}>
                  <Text color={isHighlighted ? 'cyan' : 'white'} bold={isHighlighted}>
                    {provider.displayName}
                  </Text>
                </Box>
                <Box width={18}>
                  {provider.isInstalled ? (
                    <Text color="green">● installed</Text>
                  ) : (
                    <Text color="gray">○ not installed</Text>
                  )}
                </Box>
                <Box width={18}>
                  {provider.isDefault ? (
                    <Text color="yellow" bold>[default runner]</Text>
                  ) : (
                    <Text color="gray">-</Text>
                  )}
                </Box>
                <Box width={26}>
                  <Text color="gray">
                    {provider.description.length > 24
                      ? `${provider.description.slice(0, 21)}...`
                      : provider.description}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Selected Provider Details */}
      {currentProvider && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
          <Box flexDirection="row">
            <Text bold color="white">
              {currentProvider.displayName}
            </Text>
            <Text color="gray"> ({currentProvider.id})</Text>
          </Box>
          <Text color="gray">{currentProvider.description}</Text>
          <Box flexDirection="row" marginTop={0}>
            <Text color="gray">Binary: </Text>
            <Text color="cyan">{currentProvider.binaryName || 'custom / shell'}</Text>
            <Text color="gray">  |  Installation: </Text>
            <Text color={currentProvider.isInstalled ? 'green' : 'yellow'}>
              {currentProvider.isInstalled ? 'Detected in PATH' : 'Not found in PATH'}
            </Text>
            <Text color="gray">  |  Execution: </Text>
            <Text color={currentProvider.isAllowed ? 'green' : 'red'}>
              {currentProvider.isAllowed ? 'Allowed for this repo' : 'Disallowed'}
            </Text>
          </Box>
        </Box>
      )}

      {/* Summary Box */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
        <Text color="gray">Repository Scope: </Text>
        <Text bold color={allowedProviders.length > 0 ? 'cyan' : 'yellow'}>
          {allowedProviders.length > 0
            ? `${allowedProviders.length} allowed (${allowedProviders.map((p) => p.name).join(', ')})`
            : 'None (All disabled)'}
        </Text>
        <Text color="gray">  |  Default Runner: </Text>
        <Text bold color="yellow">
          {defaultProvider ? defaultProvider.name : 'None'}
        </Text>
      </Box>

      {/* Footer Navigation Hints */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">
          [Space] Toggle Allowed  •  [d] Set Default  •  [a] Allow All Installed  •  [Enter] Save &amp; Return  •  [Esc] Back
        </Text>
      </Box>
    </Box>
  );
};
