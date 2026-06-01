/**
 * The agent loop. Glues discovery → assessment → application → execution →
 * submission. Designed to be both a long-running daemon (`loop()`) and a
 * one-shot per-stage call (used by the CLI).
 *
 * The loop is intentionally simple — no concurrency, no priority queue.
 * Operators that want sophisticated scheduling should fork. Phase 1
 * marketplace volume doesn't justify complexity here.
 */

import { MarketplaceClient } from './api.js';
import { discover } from './discovery.js';
import { defaultAssess, type AssessFn } from './assessment.js';
import { defaultExecute, workspaceForTask, type ExecuteFn } from './execution.js';
import { submit } from './submission.js';
import type { AgentConfig, Task } from './types.js';

export interface OperatorAgent {
  client: MarketplaceClient;
  config: AgentConfig;
  assess: AssessFn;
  execute: ExecuteFn;
}

export function createAgent(params: {
  config: AgentConfig;
  assess?: AssessFn;
  execute?: ExecuteFn;
}): OperatorAgent {
  return {
    client: new MarketplaceClient(params.config),
    config: params.config,
    assess: params.assess ?? defaultAssess,
    execute: params.execute ?? defaultExecute,
  };
}

/**
 * One discovery + apply pass. Returns the tasks the agent applied to.
 */
export async function discoverAndApply(agent: OperatorAgent): Promise<Array<{ task: Task; applicationId: string }>> {
  const tasks = await discover(agent.client, agent.config.capabilities);
  console.log(`[discover] ${tasks.length} task(s) match capabilities`);
  const applied: Array<{ task: Task; applicationId: string }> = [];

  for (const task of tasks) {
    const decision = await agent.assess({ task, capabilities: agent.config.capabilities });
    if (!decision.apply) {
      console.log(`[skip] ${shortId(task.id)} — ${decision.reason ?? 'assessment said no'}`);
      continue;
    }
    if (decision.estimatedHours == null) {
      console.warn(`[apply-skip] ${shortId(task.id)} — assess() returned apply:true but no estimatedHours; server requires it`);
      continue;
    }
    try {
      const r = await agent.client.apply(task.id, {
        estimatedHours: decision.estimatedHours,
        estimatedCostUsd: decision.estimatedCostUsd,
        skillPackId: decision.skillPackId ?? agent.config.capabilities.skillPackId,
        notes: decision.notes,
      });
      console.log(`[apply] ${shortId(task.id)} → application ${shortId(r.applicationId)}`);
      applied.push({ task, applicationId: r.applicationId });
    } catch (err) {
      console.warn(`[apply-fail] ${shortId(task.id)} — ${(err as Error).message}`);
    }
  }
  return applied;
}

/**
 * For tasks the buyer has accepted (status='accepted', acceptedByOperatorUserId
 * matches us), run execute() and submit().
 */
export async function executeAcceptedTasks(agent: OperatorAgent): Promise<Array<{ taskId: string; submissionId: string }>> {
  // The Phase 1 marketplace doesn't yet expose "GET tasks accepted by me"
  // as a dedicated endpoint, so we re-list and filter. Replace with a
  // dedicated endpoint or webhook subscription once the marketplace ships one.
  const tasks = await agent.client.listOpenTasks({ limit: 100 }).catch(() => [] as Task[]);
  const mine = tasks.filter(
    (t) => t.status === 'accepted' && t.acceptedByOperatorUserId === agent.config.operatorUserId,
  );

  const submitted: Array<{ taskId: string; submissionId: string }> = [];
  for (const task of mine) {
    const workspace = workspaceForTask(agent.config.workspaceRoot, task.id);
    console.log(`[execute] ${shortId(task.id)} → ${workspace}`);
    try {
      const result = await agent.execute({ task, workspace, config: agent.config });
      const r = await submit(agent.client, task, result, {
        skillPackId: agent.config.capabilities.skillPackId,
      });
      console.log(
        `[submit] ${shortId(task.id)} → submission ${shortId(r.submissionId)}; gates passed=${r.mechanicalGatesPassed}; status=${r.taskStatus}`,
      );
      submitted.push({ taskId: task.id, submissionId: r.submissionId });
    } catch (err) {
      console.warn(`[execute-fail] ${shortId(task.id)} — ${(err as Error).message}`);
    }
  }
  return submitted;
}

/**
 * Long-running loop. Polls every pollIntervalMs (default 60s) and
 * runs both discoverAndApply + executeAcceptedTasks. Catches and logs
 * errors so a transient failure doesn't kill the loop.
 */
export async function runLoop(agent: OperatorAgent, opts: { signal?: AbortSignal } = {}): Promise<void> {
  const interval = agent.config.pollIntervalMs ?? 60_000;
  console.log(`[loop] polling every ${interval}ms`);

  while (!opts.signal?.aborted) {
    try {
      await discoverAndApply(agent);
    } catch (err) {
      console.warn(`[loop] discover-and-apply error: ${(err as Error).message}`);
    }
    try {
      await executeAcceptedTasks(agent);
    } catch (err) {
      console.warn(`[loop] execute error: ${(err as Error).message}`);
    }
    await sleep(interval, opts.signal);
  }
  console.log('[loop] aborted, exiting cleanly');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

function shortId(id: string): string {
  return id.length <= 12 ? id : id.slice(0, 12) + '…';
}
