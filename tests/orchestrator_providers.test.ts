import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Orchestrator } from '../src/pipeline/orchestrator.js';
import type { AutoPilotConfig, GitHubIssue } from '../src/types/index.js';
import { DEFAULT_CONFIG, saveConfig } from '../src/config/schema.js';

describe('Orchestrator Provider Management', () => {
  let tmpDir: string;
  let config: AutoPilotConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagos-providers-test-'));
    config = {
      ...DEFAULT_CONFIG,
      repository: 'owner/test-repo',
      runner: 'claude',
      maxConcurrency: 2,
    };
  });

  it('should detect providers with correct default allowed state', async () => {
    const orchestrator = new Orchestrator(config);
    const providers = await orchestrator.getDetectedProviders();

    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThanOrEqual(2);

    const claude = providers.find((p) => p.id === 'claude');
    const agy = providers.find((p) => p.id === 'agy');

    expect(claude).toBeDefined();
    expect(agy).toBeDefined();
    expect(claude?.isDefault).toBe(true);
    expect(agy?.isDefault).toBe(false);

    // Default behavior: isAllowed matches isInstalled when allowedProviders is undefined
    if (claude?.isInstalled) {
      expect(claude.isAllowed).toBe(true);
    }
  });

  it('should respect configured allowedProviders in getDetectedProviders', async () => {
    const configWithAllowed: AutoPilotConfig = {
      ...config,
      allowedProviders: ['agy'],
    };

    const orchestrator = new Orchestrator(configWithAllowed);
    const providers = await orchestrator.getDetectedProviders();

    const claude = providers.find((p) => p.id === 'claude');
    const agy = providers.find((p) => p.id === 'agy');

    expect(claude?.isAllowed).toBe(false);
    expect(agy?.isAllowed).toBe(true);
  });

  it('should update allowed providers and default runner via setAllowedProviders', async () => {
    const orchestrator = new Orchestrator(config);

    const res = await orchestrator.setAllowedProviders(['agy'], 'agy');
    expect(res.success).toBe(true);
    expect(res.message).toContain('agy');

    expect(orchestrator.getConfig().allowedProviders).toEqual(['agy']);
    expect(orchestrator.getConfig().runner).toBe('agy');
    expect(orchestrator.getRunnerFacade().getAllowedProviders()).toEqual(['agy']);
    expect(orchestrator.getRunnerFacade().getDefaultRunner()).toBe('agy');
  });

  it('should filter out tasks whose assigned runner is not allowed during scheduling', async () => {
    const configWithAllowed: AutoPilotConfig = {
      ...config,
      allowedProviders: ['claude'],
    };

    const orchestrator = new Orchestrator(configWithAllowed);

    // Mock DAG with ready issues having different runner assignments
    const mockIssueAgy: GitHubIssue = {
      number: 10,
      title: 'Task for agy',
      body: 'Do something',
      state: 'OPEN',
      labels: [{ name: 'ready-for-agent' }, { name: 'runner:agy' }],
      url: 'https://github.com/owner/test-repo/issues/10',
      createdAt: '2026-08-19T10:00:00Z',
      updatedAt: '2026-08-19T10:00:00Z',
    };

    const dag = orchestrator.getDAG();
    dag.build([mockIssueAgy]);

    // runnerFacade should resolve to claude because agy is disallowed
    const facade = orchestrator.getRunnerFacade();
    const resolved = facade.resolveRunnerName(mockIssueAgy);
    expect(resolved).toBe('claude');
    expect(facade.isProviderAllowed(resolved)).toBe(true);
  });

  it('ensures configured workflow labels exist on repository during start()', async () => {
    const orchestrator = new Orchestrator(config);
    const gh = (orchestrator as any).gh;
    const checkAuthSpy = vi.spyOn(gh, 'checkAuth').mockResolvedValue(true);
    const ensureLabelsSpy = vi.spyOn(gh, 'ensureLabelsExist').mockResolvedValue(undefined);
    vi.spyOn(orchestrator.getQuotaMonitor(), 'fetchLiveUsage').mockResolvedValue(undefined as any);
    vi.spyOn(orchestrator, 'tick').mockResolvedValue(undefined);

    await orchestrator.start();
    await orchestrator.stop();

    expect(checkAuthSpy).toHaveBeenCalled();
    expect(ensureLabelsSpy).toHaveBeenCalledWith(config.labels);
  });

  it('resumes paused quota, DAG nodes, and frozen workers when a provider is newly allowed', async () => {
    const orchestrator = new Orchestrator({
      ...config,
      allowedProviders: ['claude'],
    });

    const quotaMonitor = orchestrator.getQuotaMonitor();
    const futureReset = new Date(Date.now() + 2 * 60 * 60 * 1000);
    quotaMonitor.triggerQuotaPause(futureReset, 'Session limit', 'agy');

    // Simulate an active worker that was paused
    const dashboard = orchestrator.getDashboard();
    dashboard.updateWorker({
      issueNumber: 42,
      title: 'AGY Task',
      branchName: 'agent/issue-42',
      status: 'paused_quota',
      runnerName: 'agy',
    });

    const resumeWorkerSpy = vi.spyOn(orchestrator, 'resumeWorker').mockResolvedValue({
      success: true,
      message: 'Resumed',
    });
    const tickSpy = vi.spyOn(orchestrator, 'tick').mockResolvedValue();

    // Now enable agy as allowed provider
    await orchestrator.setAllowedProviders(['claude', 'agy'], 'agy');

    expect(quotaMonitor.isRunnerPaused('agy')).toBe(false);
    expect(resumeWorkerSpy).toHaveBeenCalledWith(42);
    expect(tickSpy).toHaveBeenCalled();
  });
});
