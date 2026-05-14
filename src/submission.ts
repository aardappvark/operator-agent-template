/**
 * Submission: take an ExecutionResult and post it to the marketplace
 * /submit endpoint. Validates that we have at least one of (prUrl,
 * diffBlobUrl) before calling — the marketplace rejects 400 otherwise.
 */

import type { MarketplaceClient } from './api.js';
import type { Task, ExecutionResult } from './types.js';

export async function submit(
  client: MarketplaceClient,
  task: Task,
  result: ExecutionResult,
  opts: { skillPackId?: string } = {},
): Promise<{ submissionId: string; mechanicalGatesPassed: boolean; taskStatus: string }> {
  if (!result.prUrl && !result.diffBlobUrl) {
    throw new Error(
      'Submission requires either prUrl or diffBlobUrl. Open a PR (or upload a patch blob) before calling submit().',
    );
  }
  return client.submit(task.id, {
    prUrl: result.prUrl,
    diffBlobUrl: result.diffBlobUrl,
    executionAttestation: result.executionAttestation,
    operatorSelfAssessment: result.selfAssessment,
    mechanicalGatesResults: result.mechanicalGatesResults,
    skillPackId: opts.skillPackId,
  });
}
