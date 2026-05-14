/**
 * Task discovery: pull open tasks from the marketplace and filter
 * to those matching the operator's declared capabilities.
 *
 * Server-side filtering is best-effort (Phase 1 marketplace may
 * over-return). Client-side filter is the source of truth.
 */

import type { MarketplaceClient } from './api.js';
import type { Task, OperatorCapabilities } from './types.js';

export async function discover(
  client: MarketplaceClient,
  capabilities: OperatorCapabilities,
): Promise<Task[]> {
  // Pull all open tasks, then filter locally. Server may not understand
  // every filter we'd like to apply, so we treat its filters as hints.
  const tasks = await client.listOpenTasks({
    minBountyUsd: capabilities.minBountyUsd,
    limit: 100,
  });

  return tasks.filter((t) => fits(t, capabilities));
}

export function fits(task: Task, cap: OperatorCapabilities): boolean {
  if (!cap.categories.includes(task.taskCategory)) return false;
  if (!cap.tiers.includes(task.verificationTier)) return false;
  if (task.bountyUsd < cap.minBountyUsd) return false;
  if (task.bountyUsd > cap.maxBountyUsd) return false;
  return true;
}
