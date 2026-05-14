/**
 * Worked example operator config.
 *
 * This operator handles small bug-fix tasks with a verification tier
 * of 'minimal' or 'standard'. The execute() function is a *toy* that
 * demonstrates the shape but does not contain real coding logic —
 * replace it with a Claude Code subprocess or an SDK tools-loop before
 * pointing at production tasks.
 *
 * Run from this directory:
 *   tsx ../../src/cli.ts discover --config ./operator.config.ts
 */

import type { AgentConfig } from '../../src/types.js';
import type { AssessFn } from '../../src/assessment.js';
import type { ExecuteFn } from '../../src/execution.js';
import { runShell, runShellInDir, ensureFreshDir, tail } from '../../src/execution.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const config: AgentConfig = {
  marketplaceUrl: process.env.INFERLANE_EXCHANGE_URL ?? 'http://localhost:3000',
  apiKey: process.env.INFERLANE_OPERATOR_API_KEY,
  sessionCookie: process.env.INFERLANE_SESSION_COOKIE,
  operatorUserId: process.env.INFERLANE_OPERATOR_USER_ID ?? '<set me>',
  capabilities: {
    categories: ['bug-fix', 'docs'],
    stacks: ['typescript', 'javascript'],
    minBountyUsd: 25,
    maxBountyUsd: 500,
    tiers: ['minimal', 'standard'],
    skillPackId: 'echo-fix-v0',
  },
  workspaceRoot: process.env.INFERLANE_WORKSPACE_ROOT ?? './workspaces',
  pollIntervalMs: 30_000,
};

export default config;

/**
 * Custom assess: skip docs tasks above $200 (we'd be undercutting our hourly).
 * Otherwise default heuristic.
 */
export const assess: AssessFn = ({ task, capabilities }) => {
  if (task.taskCategory === 'docs' && task.bountyUsd > 200) {
    return { apply: false, reason: 'docs task too rich for default rate' };
  }
  const criteriaCount = task.rubric.criteria.length;
  return {
    apply: true,
    estimatedHours: Math.max(2, Math.min(task.operatorSlaHours - 1, criteriaCount * 1.5)),
    estimatedCostUsd: Math.round(task.bountyUsd * 0.5 * 100) / 100,
    skillPackId: capabilities.skillPackId,
    notes: `${criteriaCount} criteria; ${task.taskCategory}; tier=${task.verificationTier}`,
  };
};

/**
 * Toy execute: clones repo, appends a single line to README.md, runs gates,
 * pushes to a branch, prints what a real implementation would do.
 *
 * REAL operators replace this entire body with their LLM-driven coding loop.
 */
export const execute: ExecuteFn = async ({ task, workspace }) => {
  console.log(`[example] cloning ${task.repoUrl} into ${workspace}`);
  await ensureFreshDir(workspace);
  await runShell('git', ['clone', '--depth', '1', task.repoUrl, workspace]);

  // Make a trivial, harmless edit so mechanical gates have something
  // different to chew on. Real operators implement the actual fix here.
  const readmePath = join(workspace, 'README.md');
  try {
    await writeFile(readmePath, '\n<!-- inferlane-operator-template demo edit -->\n', { flag: 'a' });
  } catch {
    // Some repos don't have a README; that's fine for demo purposes.
  }

  const gates = task.mechanicalGates ?? {};
  const results: Awaited<ReturnType<ExecuteFn>>['mechanicalGatesResults'] = {};
  if (gates.test) {
    const r = await runShellInDir(workspace, gates.test);
    results.test = { passed: r.exitCode === 0, output: tail(r.combinedOutput, 4000) };
  }
  if (gates.lint) {
    const r = await runShellInDir(workspace, gates.lint);
    results.lint = { passed: r.exitCode === 0, output: tail(r.combinedOutput, 4000) };
  }
  if (gates.build) {
    const r = await runShellInDir(workspace, gates.build);
    results.build = { passed: r.exitCode === 0, output: tail(r.combinedOutput, 4000) };
  }

  return {
    // No real PR opened in this demo — REAL operators must:
    //   1. git checkout -b operator-<taskId>
    //   2. apply changes
    //   3. git commit + push to operator's fork
    //   4. open a draft PR via GitHub API
    //   5. set prUrl below to the draft PR URL
    prUrl: undefined,
    selfAssessment:
      'Demo executor: appended a comment to README.md to demonstrate the round-trip. ' +
      'No real fix was attempted. This submission will not pass attestation; do not run against real tasks.',
    mechanicalGatesResults: results,
    executionAttestation: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
    },
  };
};
