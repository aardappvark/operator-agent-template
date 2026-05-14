/**
 * Assessment: given a task that passes capability filters, decide
 * whether to apply, with what cost/time estimate.
 *
 * The default implementation is a deliberately-naive heuristic:
 *   - Apply to everything that passed filters
 *   - Estimate hours = max(2, min(operatorSlaHours - 2, criteria.length × 1.5))
 *   - Estimate cost = bountyUsd × 0.6 (assumes operator's own LLM tokens)
 *
 * Operators are expected to OVERRIDE assess() with their own logic.
 * Better assessments use:
 *   - Past task outcomes for similar repos
 *   - LLM-based rubric difficulty scoring
 *   - Repo size / language detection
 *   - Live token-cost predictor (Phase 2 marketplace will expose this)
 */

import type { ApplicationDecision, AssessContext } from './types.js';

export type AssessFn = (ctx: AssessContext) => Promise<ApplicationDecision> | ApplicationDecision;

export const defaultAssess: AssessFn = ({ task }) => {
  const criteriaCount = task.rubric.criteria.length;
  const estimatedHours = Math.max(2, Math.min(task.operatorSlaHours - 2, Math.ceil(criteriaCount * 1.5)));
  const estimatedCostUsd = Math.round(task.bountyUsd * 0.6 * 100) / 100;

  return {
    apply: true,
    estimatedHours,
    estimatedCostUsd,
    notes: `Default assessment: ${criteriaCount} criteria, ~${estimatedHours}h estimated.`,
  };
};
