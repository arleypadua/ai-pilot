import { execa } from 'execa';
import type { QuotaBucket, QuotaWindowType, RunnerLiveUsage, UsageProvider } from '../types.js';

export class AgyUsageProvider implements UsageProvider {
  public readonly name = 'agy';
  public readonly displayName = 'Antigravity CLI (agy)';
  private cachedUsage: RunnerLiveUsage | null = null;
  private lastFetchTime = 0;

  public parseUsageOutput(stdout: string): RunnerLiveUsage {
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    const buckets: QuotaBucket[] = [];

    for (const line of lines) {
      if (line.startsWith('Quota:')) continue;

      // Handle tab-delimited or multi-space delimited columns:
      // Group \t Window Type \t Remaining% \t ResetTimestamp
      const parts = line.includes('\t')
        ? line.split('\t').map((p) => p.trim())
        : line.split(/\s{2,}/).map((p) => p.trim());

      if (parts.length >= 3) {
        const group = parts[0];
        const windowDesc = parts[1];
        const pctRaw = parts[2];
        const resetTimestamp = parts[3];

        const pctMatch = pctRaw.match(/(\d+)%/);
        if (!pctMatch) continue;

        const remainingPercentage = parseInt(pctMatch[1], 10);
        const usedPercentage = Math.max(0, 100 - remainingPercentage);

        let windowType: QuotaWindowType = 'other';
        const lowerDesc = windowDesc.toLowerCase();
        if (lowerDesc.includes('five hour') || lowerDesc.includes('5-hour') || lowerDesc.includes('5 hour')) {
          windowType = 'five_hour';
        } else if (lowerDesc.includes('week')) {
          windowType = 'weekly';
        } else if (lowerDesc.includes('day') || lowerDesc.includes('daily')) {
          windowType = 'daily';
        }

        let resetAt: Date | undefined = undefined;
        let resetText: string | undefined = undefined;
        if (resetTimestamp) {
          try {
            const parsedDate = new Date(resetTimestamp);
            if (!isNaN(parsedDate.getTime())) {
              resetAt = parsedDate;
              resetText = parsedDate.toLocaleTimeString();
            }
          } catch {}
        }

        let windowLabel = windowDesc;
        if (windowType === 'five_hour') windowLabel = '5h';
        else if (windowType === 'weekly') windowLabel = 'Weekly';

        let name = `${group} (${windowLabel})`;
        if (group.toLowerCase().includes('gemini')) {
          name = windowType === 'five_hour' ? 'Gemini 5h' : 'Gemini Weekly';
        } else if (group.toLowerCase().includes('claude') || group.toLowerCase().includes('gpt')) {
          name = windowType === 'five_hour' ? 'Claude/GPT 5h' : 'Claude/GPT Weekly';
        }

        buckets.push({
          name,
          group,
          windowType,
          usedPercentage,
          remainingPercentage,
          resetAt,
          resetText,
        });
      }
    }

    // Sort buckets so 5h appears before Weekly within each group
    buckets.sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group);
      if (a.windowType === 'five_hour' && b.windowType !== 'five_hour') return -1;
      if (a.windowType !== 'five_hour' && b.windowType === 'five_hour') return 1;
      return 0;
    });

    const runnerUsage: RunnerLiveUsage = {
      runnerName: this.name,
      displayName: this.displayName,
      buckets,
      lastFetchedAt: new Date(),
      rawText: stdout,
    };

    return runnerUsage;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? 'where' : 'which';
      const { exitCode } = await execa(cmd, ['agy'], { reject: false });
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  public async fetchUsage(forceRefresh = false): Promise<RunnerLiveUsage | null> {
    const now = Date.now();
    if (!forceRefresh && this.cachedUsage && now - this.lastFetchTime < 60 * 1000) {
      return this.cachedUsage;
    }

    const available = await this.isAvailable();
    if (!available) {
      return null;
    }

    try {
      const { stdout } = await execa('agy', ['-p', '/usage'], {
        stdin: 'ignore',
        timeout: 10000,
        env: {
          ...process.env,
          CI: 'true',
        },
      });

      const usage = this.parseUsageOutput(stdout);
      this.cachedUsage = usage;
      this.lastFetchTime = now;
      return usage;
    } catch {
      return this.cachedUsage;
    }
  }

  public getCachedUsage(): RunnerLiveUsage | null {
    return this.cachedUsage;
  }
}
