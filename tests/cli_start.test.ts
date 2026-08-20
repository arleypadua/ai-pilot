import { describe, it, expect, vi, beforeEach } from 'vitest';
import { program } from '../src/cli.js';
import { Orchestrator } from '../src/pipeline/orchestrator.js';
import { loadConfig } from '../src/config/schema.js';

vi.mock('../src/pipeline/orchestrator.js', () => {
  return {
    Orchestrator: vi.fn().mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    })),
  };
});

vi.mock('../src/config/schema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/schema.js')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

describe('imagos start --runner option precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should preserve runner configured in config.json when --runner is omitted', async () => {
    vi.mocked(loadConfig).mockResolvedValueOnce({
      repository: 'arleypadua/imagos',
      baseBranch: 'main',
      runner: 'agy',
      maxConcurrency: 2,
      pollIntervalSeconds: 30,
      autoMerge: true,
      mergeMethod: 'squash',
      cleanupWorktreeOnClose: true,
      quota: { pauseOnLimit: true, utilizationThreshold: 0.95, proxyPort: 9876 },
      labels: {
        readyForAgent: 'ready-for-agent',
        needsInfo: 'needs-info',
        readyForHuman: 'ready-for-human',
        needsTriage: 'needs-triage',
        wontfix: 'wontfix',
      },
    });

    await program.parseAsync(['node', 'imagos', 'start', '--no-interactive']);

    expect(Orchestrator).toHaveBeenCalled();
    const passedConfig = vi.mocked(Orchestrator).mock.calls[0][0];
    expect(passedConfig.runner).toBe('agy');
  });

  it('should override runner when --runner is explicitly passed via CLI', async () => {
    vi.mocked(loadConfig).mockResolvedValueOnce({
      repository: 'arleypadua/imagos',
      baseBranch: 'main',
      runner: 'agy',
      maxConcurrency: 2,
      pollIntervalSeconds: 30,
      autoMerge: true,
      mergeMethod: 'squash',
      cleanupWorktreeOnClose: true,
      quota: { pauseOnLimit: true, utilizationThreshold: 0.95, proxyPort: 9876 },
      labels: {
        readyForAgent: 'ready-for-agent',
        needsInfo: 'needs-info',
        readyForHuman: 'ready-for-human',
        needsTriage: 'needs-triage',
        wontfix: 'wontfix',
      },
    });

    await program.parseAsync(['node', 'imagos', 'start', '--runner', 'claude', '--no-interactive']);

    expect(Orchestrator).toHaveBeenCalled();
    const passedConfig = vi.mocked(Orchestrator).mock.calls[0][0];
    expect(passedConfig.runner).toBe('claude');
  });
});
