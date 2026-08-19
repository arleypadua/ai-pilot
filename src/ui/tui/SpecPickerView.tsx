import React from 'react';
import { Box, Text } from 'ink';

export interface SpecOption {
  number?: number;
  title: string;
  childCount?: number;
  completedCount?: number;
  isAllTasks?: boolean;
}

interface SpecPickerViewProps {
  options: SpecOption[];
  highlightedIndex: number;
  selectedNumbers: Set<number>;
  isAllTasksSelected: boolean;
  repository?: string;
}

export const SpecPickerView: React.FC<SpecPickerViewProps> = ({
  options,
  highlightedIndex,
  selectedNumbers,
  isAllTasksSelected,
  repository,
}) => {
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

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* Header Banner */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text backgroundColor="cyan" color="black" bold>
            {' 🎯 SELECT TARGET SPECIFICATION SCOPE '}
          </Text>
          {repository && <Text color="gray"> | Repo: {repository}</Text>}
        </Box>
        <Text color="gray">
          Select specs with [Space], or choose Any unblocked task. Active workers continue uninterrupted.
        </Text>
      </Box>

      {/* Options List */}
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box marginBottom={1}>
          <Text bold color="white" underline>
            Pending Specs &amp; Execution Modes:
          </Text>
        </Box>

        <Box flexDirection="column">
          {options.map((opt, index) => {
            const isHighlighted = index === highlightedIndex;
            const prefix = isHighlighted ? '❯ ' : '  ';

            if (opt.isAllTasks) {
              const isChecked = isAllTasksSelected;
              const checkmark = isChecked ? '[x] ' : '[ ] ';

              return (
                <Box key="all-tasks" flexDirection="row" marginTop={0}>
                  <Text color={isHighlighted ? 'cyan' : 'gray'}>{prefix}</Text>
                  <Text color={isChecked ? 'green' : 'gray'} bold={isChecked}>
                    {checkmark}
                  </Text>
                  <Text color={isHighlighted ? 'cyan' : isChecked ? 'green' : 'white'} bold={isHighlighted || isChecked}>
                    ✨ {opt.title}
                  </Text>
                </Box>
              );
            }

            const isChecked = !isAllTasksSelected && opt.number !== undefined && selectedNumbers.has(opt.number);
            const checkmark = isChecked ? '[x] ' : '[ ] ';
            const progressStr =
              opt.childCount !== undefined
                ? ` (${opt.completedCount || 0}/${opt.childCount} sub-tasks complete)`
                : '';

            return (
              <Box key={opt.number} flexDirection="row" marginTop={0}>
                <Text color={isHighlighted ? 'cyan' : 'gray'}>{prefix}</Text>
                <Text color={isChecked ? 'cyan' : 'gray'} bold={isChecked}>
                  {checkmark}
                </Text>
                <Box width={10}>
                  <Text color={isHighlighted ? 'cyan' : isChecked ? 'cyan' : 'white'} bold={isHighlighted || isChecked}>
                    #{opt.number}
                  </Text>
                </Box>
                <Box width={45}>
                  <Text color={isHighlighted ? 'cyan' : isChecked ? 'cyan' : 'white'} bold={isHighlighted || isChecked}>
                    {opt.title.length > 42 ? `${opt.title.slice(0, 39)}...` : opt.title}
                  </Text>
                </Box>
                <Text color="gray">{progressStr}</Text>
              </Box>
            );
          })}
        </Box>

        {/* Selected Summary */}
        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="gray">Current Selection: </Text>
          <Text bold color={isAllTasksSelected || selectedCount > 0 ? 'cyan' : 'yellow'}>
            {summaryText}
          </Text>
        </Box>
      </Box>

      {/* Footer Navigation Hints */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">
          [↑/↓ or j/k] Navigate  •  [Space] Toggle  •  [a] Toggle Any  •  [Enter] Start Session  •  [Esc] Cancel
        </Text>
      </Box>
    </Box>
  );
};
