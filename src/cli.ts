#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, detectRepository, getConfigPath } from './config/schema.js';
import { Orchestrator } from './pipeline/orchestrator.js';
import { GitHubClient } from './github/client.js';
import { IssueDAG } from './github/dag.js';
import { WorktreeManager } from './worktree/manager.js';
import { StateManager } from './state/manager.js';
import Table from 'cli-table3';

const program = new Command();

program
  .name('agent-autopilot')
  .description('Autonomous multi-agent GitHub issue orchestrator powered by Claude CLI & git worktrees')
  .version('0.1.0');

// 1. START COMMAND
program
  .command('start')
  .description('Start the autonomous orchestrator daemon with live terminal dashboard')
  .option('-c, --config <path>', 'Path to config.json')
  .option('-r, --repo <owner/repo>', 'Target GitHub repository (e.g. owner/repo)')
  .option('-m, --concurrency <number>', 'Maximum parallel tasks', parseInt)
  .option('--runner <runner>', 'Runner to use (claude, agy, pi, custom)', 'claude')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      if (options.repo) config.repository = options.repo;
      if (options.concurrency) config.maxConcurrency = options.concurrency;
      if (options.runner) config.runner = options.runner;

      if (!config.repository) {
        console.error(
          pc.red('Error: Target repository not specified and could not be detected from git remote.')
        );
        console.log(pc.yellow('Please specify via --repo <owner/repo> or in .autopilot/config.json'));
        process.exit(1);
      }

      console.log(pc.cyan(`Starting Agent Auto-Pilot for ${config.repository}...`));
      const orchestrator = new Orchestrator(config);

      const shutdown = () => {
        console.log(pc.yellow('\nShutting down gracefully...'));
        orchestrator.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await orchestrator.start();
    } catch (err: any) {
      console.error(pc.red(`Fatal Error: ${err.message}`));
      process.exit(1);
    }
  });

// 2. INIT COMMAND
program
  .command('init')
  .description('Initialize .autopilot/config.json for the current project')
  .option('-r, --repo <owner/repo>', 'GitHub repository')
  .action(async (options) => {
    try {
      const detectedRepo = options.repo || (await detectRepository());
      const config = {
        $schema: 'https://raw.githubusercontent.com/owner/agent-autopilot/main/schema.json',
        repository: detectedRepo || 'owner/repo',
        baseBranch: 'main',
        maxConcurrency: 2,
        pollIntervalSeconds: 30,
        runner: 'claude',
        testCommand: 'npm test',
        autoMerge: true,
        mergeMethod: 'squash',
        cleanupWorktreeOnClose: true,
        quota: {
          pauseOnLimit: true,
          utilizationThreshold: 0.95,
        },
        labels: {
          readyForAgent: 'ready-for-agent',
          needsInfo: 'needs-info',
          readyForHuman: 'ready-for-human',
          needsTriage: 'needs-triage',
          wontfix: 'wontfix',
        },
      };

      const savedPath = saveConfig(config as any);
      console.log(pc.green(`✓ Created ${savedPath}`));
      console.log(pc.green('✓ Updated .gitignore (tracking config.json, ignoring runtime state/worktrees)'));
    } catch (err: any) {
      console.error(pc.red(`Failed to initialize config: ${err.message}`));
      process.exit(1);
    }
  });

// 3. STATUS COMMAND
program
  .command('status')
  .description('Display runtime metadata, active task sessions, worktrees, and DAG')
  .option('-c, --config <path>', 'Path to config.json')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      const stateMgr = new StateManager();
      const runtimeState = stateMgr.getState();

      const gh = new GitHubClient({ repository: config.repository });
      const issues = await gh.fetchIssues();

      const dag = new IssueDAG(config);
      dag.build(issues);

      const worktreeMgr = new WorktreeManager();
      const activeWorktrees = await worktreeMgr.listActiveWorktrees();

      console.log(pc.bold(pc.cyan(`\n=== AGENT AUTO-PILOT RUNTIME STATE ===\n`)));
      console.log(`Repository: ${pc.bold(config.repository || 'Local')}`);
      console.log(`Daemon Status: ${pc.bold(runtimeState.daemonStatus)}`);
      if (runtimeState.quotaPausedUntil) {
        console.log(pc.red(`Quota Paused Until: ${runtimeState.quotaPausedUntil}`));
      }
      console.log('');

      // Active Sessions from state.json
      console.log(pc.bold('Active Task Sessions (.autopilot/sessions/):'));
      const activeTaskEntries = Object.values(runtimeState.activeTasks);
      if (activeTaskEntries.length === 0) {
        console.log(pc.gray('  No active sessions currently running.\n'));
      } else {
        const sessionTable = new Table({
          head: [pc.cyan('Issue'), pc.cyan('Title'), pc.cyan('Status'), pc.cyan('Worktree Path')],
        });
        for (const task of activeTaskEntries) {
          sessionTable.push([`#${task.issueNumber}`, task.title.slice(0, 30), task.status, task.worktreePath]);
        }
        console.log(sessionTable.toString());
        console.log('');
      }

      // Worktrees Table
      console.log(pc.bold('Active Worktrees on Disk:'));
      if (activeWorktrees.length === 0) {
        console.log(pc.gray('  No active worktrees found in .autopilot/worktrees/\n'));
      } else {
        const wtTable = new Table({
          head: [pc.cyan('Issue #'), pc.cyan('Branch'), pc.cyan('Worktree Path')],
        });
        for (const wt of activeWorktrees) {
          wtTable.push([wt.issueNumber ? `#${wt.issueNumber}` : 'N/A', wt.branch, wt.path]);
        }
        console.log(wtTable.toString());
        console.log('');
      }

      // Issue DAG Table
      console.log(pc.bold('GitHub Issue DAG:'));
      const issueTable = new Table({
        head: [pc.cyan('Issue'), pc.cyan('Title'), pc.cyan('Kind'), pc.cyan('Status'), pc.cyan('Blockers')],
      });

      for (const node of dag.getAllNodes()) {
        let statusColor = pc.gray(node.status);
        if (node.status === 'ready') statusColor = pc.green(node.status);
        if (node.status === 'waiting_feedback') statusColor = pc.yellow(node.status);
        if (node.status === 'blocked') statusColor = pc.red(node.status);

        issueTable.push([
          `#${node.issue.number}`,
          node.issue.title.slice(0, 30),
          node.kind,
          statusColor,
          node.blockers.length > 0 ? node.blockers.join(', ') : pc.gray('None'),
        ]);
      }

      console.log(issueTable.toString());
    } catch (err: any) {
      console.error(pc.red(`Status error: ${err.message}`));
      process.exit(1);
    }
  });

// 4. LOGS COMMAND
program
  .command('logs <issueNumber>')
  .description('View execution output logs for a specific issue from .autopilot/sessions/')
  .option('-t, --tail <lines>', 'Number of lines to show', '50')
  .action((issueNumberStr, options) => {
    const issueNumber = parseInt(issueNumberStr, 10);
    const stateMgr = new StateManager();
    const session = stateMgr.getSession(issueNumber);

    if (!session.metadata && !session.stdout) {
      console.log(pc.yellow(`No session logs found for Issue #${issueNumber} in .autopilot/sessions/issue-${issueNumber}/`));
      return;
    }

    console.log(pc.bold(pc.cyan(`\n=== SESSION LOGS: Issue #${issueNumber} ===\n`)));
    if (session.metadata) {
      console.log(`Title: ${session.metadata.title}`);
      console.log(`Branch: ${session.metadata.branchName}`);
      console.log(`Status: ${session.metadata.status}`);
      console.log(`Started: ${session.metadata.startedAt}`);
      console.log('');
    }

    if (session.stdout) {
      console.log(pc.bold('Output Stream (stdout):'));
      const lines = session.stdout.split('\n');
      const tailCount = parseInt(options.tail, 10);
      const displayLines = lines.slice(-tailCount).join('\n');
      console.log(displayLines);
    }

    if (session.stderr && session.stderr.trim()) {
      console.log(pc.bold(pc.red('\nErrors (stderr):')));
      console.log(session.stderr);
    }
  });

// 5. CLEAN COMMAND
program
  .command('clean')
  .description('Clean up all inactive worktrees and temporary agent branches')
  .action(async () => {
    try {
      const worktreeMgr = new WorktreeManager();
      const worktrees = await worktreeMgr.listActiveWorktrees();

      console.log(pc.cyan(`Cleaning up ${worktrees.length} worktrees...`));
      for (const wt of worktrees) {
        if (wt.issueNumber) {
          await worktreeMgr.cleanupWorktree(wt.issueNumber, undefined, true);
          console.log(pc.green(`✓ Removed worktree for issue #${wt.issueNumber}`));
        }
      }
      console.log(pc.green('✓ All agent worktrees cleaned up.'));
    } catch (err: any) {
      console.error(pc.red(`Clean error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
