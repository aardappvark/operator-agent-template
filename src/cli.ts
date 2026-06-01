#!/usr/bin/env node
/**
 * CLI for the operator agent template.
 *
 * Subcommands:
 *   discover                            List tasks matching capabilities
 *   apply <taskId>                      Apply to a specific task
 *   execute <taskId>                    Execute + submit a single accepted task
 *   loop                                Long-running discover/apply/execute loop
 *
 * Config is loaded from `./operator.config.ts` in the working directory
 * (a TS module exporting `default` as an `AgentConfig` plus optional
 * `assess` / `execute` overrides). See examples/echo-fix/operator.config.ts.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { createAgent, discoverAndApply, executeAcceptedTasks, runLoop } from './agent.js';
import { discover } from './discovery.js';
import { workspaceForTask } from './execution.js';
import { submit } from './submission.js';
import type { AgentConfig } from './types.js';
import type { AssessFn } from './assessment.js';
import type { ExecuteFn } from './execution.js';

interface LoadedConfig {
  default: AgentConfig;
  assess?: AssessFn;
  execute?: ExecuteFn;
}

async function loadConfig(path: string): Promise<LoadedConfig> {
  const abs = resolve(process.cwd(), path);
  if (!existsSync(abs)) {
    throw new Error(
      `Config file not found at ${abs}. Pass --config <path>, or create operator.config.ts in the cwd.`,
    );
  }
  const url = pathToFileURL(abs).href;
  // Dynamic import; works for both .ts (under tsx) and .js (compiled).
  const mod = (await import(url)) as LoadedConfig;
  if (!mod.default) {
    throw new Error(`Config at ${abs} must export a default AgentConfig.`);
  }
  return mod;
}

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string> } {
  const [, , command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a) continue;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[k] = next;
        i++;
      } else {
        flags[k] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

function help(): void {
  process.stdout.write(`
operator-agent — InferLane Exchange operator reference template

Usage:
  operator-agent <command> [args] [--config path]

Commands:
  discover                        List tasks matching capabilities
  apply <taskId>                  Apply to a specific task
  execute <taskId>                Execute + submit a single accepted task
  loop                            Long-running discover/apply/execute loop
  help                            Show this message

Config:
  By default, loads ./operator.config.ts from cwd. Override with --config.
  See examples/echo-fix/operator.config.ts for the expected shape.
`);
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv);
  if (command === 'help' || command === '--help' || command === '-h') {
    help();
    return;
  }

  const configPath = flags.config ?? './operator.config.ts';
  const cfg = await loadConfig(configPath);
  const agent = createAgent({
    config: cfg.default,
    assess: cfg.assess,
    execute: cfg.execute,
  });

  switch (command) {
    case 'discover': {
      const tasks = await discover(agent.client, agent.config.capabilities);
      if (tasks.length === 0) {
        console.log('No matching tasks.');
        return;
      }
      for (const t of tasks) {
        console.log(
          `${t.id}  $${t.bountyUsd.toFixed(2)}  [${t.verificationTier}]  ${t.taskCategory}  — ${t.title}`,
        );
      }
      return;
    }
    case 'apply': {
      const taskId = positional[0];
      if (!taskId) throw new Error('Usage: apply <taskId>');
      const task = await agent.client.getTask(taskId);
      const decision = await agent.assess({ task, capabilities: agent.config.capabilities });
      if (!decision.apply) {
        console.log(`Skipped: ${decision.reason ?? 'assessment said no'}`);
        return;
      }
      if (decision.estimatedHours == null) {
        throw new Error('assess() returned apply:true but no estimatedHours — server requires it');
      }
      const r = await agent.client.apply(taskId, {
        estimatedHours: decision.estimatedHours,
        estimatedCostUsd: decision.estimatedCostUsd,
        skillPackId: decision.skillPackId ?? agent.config.capabilities.skillPackId,
        notes: decision.notes,
      });
      console.log(`Applied → application ${r.applicationId}`);
      return;
    }
    case 'execute': {
      const taskId = positional[0];
      if (!taskId) throw new Error('Usage: execute <taskId>');
      const task = await agent.client.getTask(taskId);
      if (task.status !== 'accepted' || task.acceptedByOperatorUserId !== agent.config.operatorUserId) {
        throw new Error(
          `Task ${taskId} status=${task.status}, accepted by ${task.acceptedByOperatorUserId ?? 'noone'} ` +
            `(this agent is ${agent.config.operatorUserId}). Cannot execute.`,
        );
      }
      const workspace = workspaceForTask(agent.config.workspaceRoot, task.id);
      const result = await agent.execute({ task, workspace, config: agent.config });
      const r = await submit(agent.client, task, result, {
        skillPackId: agent.config.capabilities.skillPackId,
      });
      console.log(
        `Submitted → ${r.submissionId}; gates passed=${r.mechanicalGatesPassed}; task status=${r.taskStatus}`,
      );
      return;
    }
    case 'discover-and-apply': {
      const r = await discoverAndApply(agent);
      console.log(`Applied to ${r.length} task(s).`);
      return;
    }
    case 'execute-accepted': {
      const r = await executeAcceptedTasks(agent);
      console.log(`Submitted ${r.length} task(s).`);
      return;
    }
    case 'loop': {
      const ctrl = new AbortController();
      process.once('SIGINT', () => {
        console.log('\n[cli] SIGINT received, stopping after current cycle');
        ctrl.abort();
      });
      await runLoop(agent, { signal: ctrl.signal });
      return;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      help();
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`[cli] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
