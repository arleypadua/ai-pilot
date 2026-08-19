import React from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';
import type { Orchestrator } from '../pipeline/orchestrator.js';

export interface InteractiveDashboardInstance {
  unmount: () => void;
  waitUntilExit: () => Promise<unknown>;
}

export function startInteractiveDashboard(
  orchestrator: Orchestrator,
  onExitCallback?: () => void
): InteractiveDashboardInstance {
  orchestrator.setInteractive(true);

  let isExiting = false;
  const handleExit = () => {
    if (isExiting) return;
    isExiting = true;
    try {
      instance.unmount();
    } catch {}
    try {
      orchestrator.stop();
    } catch {}
    if (onExitCallback) {
      onExitCallback();
    } else {
      process.exit(0);
    }
  };

  const instance = render(<App orchestrator={orchestrator} onExit={handleExit} />);
  return instance;
}
