import React from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';
import type { Orchestrator } from '../pipeline/orchestrator.js';

import { Notifier } from '../notifications/notifier.js';
import { ActivityLogger } from '../logger/index.js';

export interface InteractiveDashboardInstance {
  unmount: () => void;
  waitUntilExit: () => Promise<unknown>;
}

export function startInteractiveDashboard(
  orchestrator: Orchestrator,
  onExitCallback?: () => void | Promise<void>
): InteractiveDashboardInstance {
  orchestrator.setInteractive(true);
  Notifier.setInteractive(true);
  ActivityLogger.setLogHandler((msg) => orchestrator.getDashboard().log(msg));
  Notifier.setLogHandler((msg) => orchestrator.getDashboard().log(msg));
  ActivityLogger.interceptConsole();

  let isExiting = false;
  const handleExit = async () => {
    if (isExiting) return;
    isExiting = true;
    ActivityLogger.restoreConsole();
    Notifier.setInteractive(false);
    Notifier.setLogHandler(undefined);
    ActivityLogger.setLogHandler(undefined);
    try {
      instance.unmount();
    } catch {}
    try {
      await orchestrator.stop();
    } catch {}
    if (onExitCallback) {
      await onExitCallback();
    } else {
      process.exit(0);
    }
  };

  const instance = render(<App orchestrator={orchestrator} onExit={handleExit} />);
  return instance;
}
