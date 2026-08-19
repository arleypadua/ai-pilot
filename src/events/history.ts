import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentEvent } from './bus.js';
import { AgentEventBus } from './bus.js';
import { StateManager } from '../state/manager.js';
import { WorktreeManager } from '../worktree/manager.js';

export function loadHistoricalEvents(issueNumber: number, worktreePath?: string): AgentEvent[] {
  const eventBus = AgentEventBus.getInstance();
  const existingHistory = eventBus.getHistory(issueNumber);
  if (existingHistory.length > 0) {
    return existingHistory;
  }

  const events: AgentEvent[] = [];
  const stateMgr = new StateManager();
  const session = stateMgr.getSession(issueNumber);

  const worktreeMgr = new WorktreeManager();
  const targetWorktree = worktreePath || session.metadata?.worktreePath || worktreeMgr.getWorktreePathForIssue(issueNumber);

  // 1. Check Claude session JSONL in ~/.claude/projects/
  try {
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (fs.existsSync(claudeProjectsDir)) {
      const sanitizedPath = targetWorktree.replace(/\//g, '-');
      const projectDirs = fs.readdirSync(claudeProjectsDir);
      const matchDir = projectDirs.find((d) => d.includes(`issue-${issueNumber}`) || d === sanitizedPath);

      if (matchDir) {
        const fullMatchPath = path.join(claudeProjectsDir, matchDir);
        const files = fs.readdirSync(fullMatchPath).filter((f) => f.endsWith('.jsonl'));
        if (files.length > 0) {
          const stats = files.map((f) => ({
            file: f,
            mtime: fs.statSync(path.join(fullMatchPath, f)).mtimeMs,
          }));
          stats.sort((a, b) => b.mtime - a.mtime);
          const latestJsonl = path.join(fullMatchPath, stats[0].file);

          const content = fs.readFileSync(latestJsonl, 'utf8');
          const lines = content.split('\n').filter(Boolean);
          const recentLines = lines.slice(-40);

          for (const line of recentLines) {
            try {
              const parsed = JSON.parse(line);
              const timeStr = parsed.timestamp
                ? new Date(parsed.timestamp).toLocaleTimeString()
                : new Date().toLocaleTimeString();

              if (parsed.type === 'assistant' && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === 'tool_use') {
                    const inputSummary = block.input ? JSON.stringify(block.input).slice(0, 100) : '';
                    events.push({
                      id: `hist-${events.length}-${Math.random().toString(36).slice(2, 6)}`,
                      issueNumber,
                      type: 'tool_start',
                      timestamp: timeStr,
                      summary: `🔧 ${block.name}: ${inputSummary}`,
                      detail: { name: block.name, input: block.input },
                    });
                  } else if (block.type === 'text' && block.text) {
                    const text = block.text.trim();
                    if (text) {
                      events.push({
                        id: `hist-${events.length}-${Math.random().toString(36).slice(2, 6)}`,
                        issueNumber,
                        type: 'thought',
                        timestamp: timeStr,
                        summary: text,
                      });
                    }
                  }
                }
              } else if (parsed.type === 'user' && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === 'tool_result') {
                    events.push({
                      id: `hist-${events.length}-${Math.random().toString(36).slice(2, 6)}`,
                      issueNumber,
                      type: 'tool_end',
                      timestamp: timeStr,
                      summary: `✓ Tool result received`,
                      detail: { toolUseId: block.tool_use_id },
                    });
                  }
                }
              }
            } catch {}
          }
        }
      }
    }
  } catch {}

  // 2. If no JSONL events or few events found, inspect session timeline and stdout from state
  if (events.length === 0) {
    if (session.metadata?.timeline && session.metadata.timeline.length > 0) {
      for (const item of session.metadata.timeline) {
        const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        events.push({
          id: `hist-stage-${events.length}`,
          issueNumber,
          type: item.stage === 'PROMPT_INJECTED' ? 'prompt_injected' : 'info',
          timestamp: timeStr,
          summary: `[${item.stage}] ${item.message || ''}`,
        });
      }
    }

    if (session.stdout) {
      const stdoutLines = session.stdout.split('\n').filter((l) => l.trim().length > 0).slice(-15);
      for (const line of stdoutLines) {
        events.push({
          id: `hist-stdout-${events.length}`,
          issueNumber,
          type: 'stdout',
          timestamp: new Date().toLocaleTimeString(),
          summary: line.trim(),
        });
      }
    }
  }

  // 3. If worktree is paused, add an informative notice at the end if not already present
  if (session.metadata?.status === 'paused_quota') {
    events.push({
      id: `hist-notice-${Date.now()}`,
      issueNumber,
      type: 'info',
      timestamp: new Date().toLocaleTimeString(),
      summary: 'Task execution is paused due to 5h quota limits. Worktree is preserved and will auto-resume.',
    });
  }

  // Prepopulate event bus history
  if (events.length > 0) {
    for (const evt of events) {
      eventBus.emitAgentEvent(evt);
    }
  }

  return events;
}
