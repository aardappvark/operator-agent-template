/**
 * Execution: clone the repo, do the work, run the gates.
 *
 * THIS IS THE EXTENSION POINT. The default implementation is a stub
 * that just clones + runs the buyer's mechanical gates against an
 * unchanged tree. Real operators replace executeFn() with logic that
 * actually changes the code.
 *
 * Two common patterns for the inner "do the work" step:
 *
 *   1. **Subprocess Claude Code** — spawn `claude --print` against the
 *      cloned tree with a prompt assembled from task.description +
 *      task.rubric. Capture token counts from session output. Cheap,
 *      simple, well-understood.
 *
 *   2. **Anthropic SDK in-process** — use @anthropic-ai/sdk + a tools
 *      loop (read/write/bash). More control over context + cost but
 *      requires building the agent harness yourself.
 *
 * Either way, the operator's real value is the prompt engineering +
 * harness around the LLM call. We can't ship that for you — taste,
 * domain knowledge, and continuous tuning is what makes operators
 * differentiate. The execution.ts in this template is a working shell;
 * you wire your loop into it.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task, ExecutionResult, AgentConfig } from './types.js';

export type ExecuteFn = (params: {
  task: Task;
  workspace: string;
  config: AgentConfig;
}) => Promise<ExecutionResult>;

/**
 * Default execute: clones repo, runs gates against unchanged tree.
 * Will FAIL the test gate by design — real operators must replace this.
 */
export const defaultExecute: ExecuteFn = async ({ task, workspace, config }) => {
  console.warn(
    '[execute] DEFAULT IMPLEMENTATION — does not modify code. ' +
      'Replace with your own ExecuteFn before applying to real tasks.',
  );

  await ensureFreshDir(workspace);
  await runShell('git', ['clone', '--depth', '1', task.repoUrl, workspace]);

  const gates = task.mechanicalGates ?? {};
  const results: ExecutionResult['mechanicalGatesResults'] = {};

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
    selfAssessment:
      'Default executor — no code changes were made. This submission is expected to fail mechanical gates.',
    mechanicalGatesResults: results,
    executionAttestation: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
    },
  };
};

// ---------------------------------------------------------------------------
// Helpers — exported so operators can reuse them in their own ExecuteFn
// ---------------------------------------------------------------------------

export async function ensureFreshDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  durationMs: number;
}

export function runShell(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd: opts.cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let combined = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      combined += s;
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      combined += s;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        combinedOutput: combined,
        durationMs: Date.now() - started,
      });
    });
  });
}

export function runShellInDir(cwd: string, command: string): Promise<ShellResult> {
  // Use sh -c so buyer-provided gate strings (e.g. "npm test") work as-is.
  // Trust boundary: this runs against a freshly-cloned repo — no buyer
  // code touches the operator's host outside this directory.
  return runShell('sh', ['-c', command], { cwd });
}

export function tail(s: string, max: number): string {
  if (s.length <= max) return s;
  return '…' + s.slice(s.length - max + 1);
}

export function workspaceForTask(workspaceRoot: string, taskId: string): string {
  return join(workspaceRoot, taskId);
}
