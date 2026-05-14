/**
 * Shared types for the operator agent. These mirror the marketplace API
 * shapes — keep in sync with src/lib/exchange/* in the inferlane-byok repo.
 *
 * If the marketplace publishes an OpenAPI spec or typed SDK in the future,
 * this file should be replaced by the generated types.
 */

import { z } from 'zod';

export const RubricCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  weight: z.number(),
  blocking: z.boolean().optional(),
});

export const TaskSchema = z.object({
  id: z.string(),
  buyerUserId: z.string(),
  title: z.string(),
  description: z.string(),
  taskCategory: z.string(),
  repoUrl: z.string().url(),
  issueUrl: z.string().url().optional().nullable(),
  bountyUsd: z.coerce.number(),
  operatorCollateralUsd: z.coerce.number(),
  arbiterCount: z.number().int(),
  attestationFeePerArbiterUsd: z.coerce.number(),
  totalEscrowUsd: z.coerce.number(),
  verificationTier: z.enum(['minimal', 'standard', 'high', 'maximum']),
  rubric: z.object({ criteria: z.array(RubricCriterionSchema) }),
  mechanicalGates: z.record(z.string(), z.string()).optional(),
  acquisitionMode: z.enum(['apply_then_accept', 'instant_claim']),
  applicationWindowHours: z.number().int(),
  operatorSlaHours: z.number().int(),
  status: z.string(),
  acceptedByOperatorUserId: z.string().nullable().optional(),
  acceptedAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type Task = z.infer<typeof TaskSchema>;
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export interface ApplicationDecision {
  apply: boolean;
  estimatedHours?: number;
  estimatedCostUsd?: number;
  skillPackId?: string;
  notes?: string;
  reason?: string;
}

export interface AssessContext {
  task: Task;
  /** Operator's declared capabilities (from operator config). */
  capabilities: OperatorCapabilities;
}

export interface OperatorCapabilities {
  /** Categories the operator can handle (matches task.taskCategory). */
  categories: string[];
  /** Languages / frameworks the operator handles (matches against repo metadata). */
  stacks: string[];
  /** Maximum bounty the operator will tackle. Filters out tasks too small to bother with. */
  minBountyUsd: number;
  /** Maximum bounty above which the operator declines (avoid overcommitting). */
  maxBountyUsd: number;
  /** Verification tiers the operator is comfortable with. */
  tiers: Array<'minimal' | 'standard' | 'high' | 'maximum'>;
  /** Free-form skill pack id (if registered). Phase 1 marketplace treats as opaque. */
  skillPackId?: string;
}

export interface ExecutionResult {
  /** PR URL the operator opened (or hosted patch URL). */
  prUrl?: string;
  /** Alternative: a blob URL for the diff (Phase 1.5). */
  diffBlobUrl?: string;
  /** Operator's free-form self-assessment (max 5000 chars). */
  selfAssessment?: string;
  /** Mechanical gate results (test/lint/build). */
  mechanicalGatesResults: {
    test?: { passed: boolean; output?: string };
    lint?: { passed: boolean; output?: string };
    build?: { passed: boolean; output?: string };
  };
  /** Token / cost accounting from the LLM session(s). */
  executionAttestation: {
    steps?: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      startedAt: string;
      completedAt?: string;
      purpose: string;
    }>;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    estimatedCostUsd?: number;
  };
}

export interface AgentConfig {
  /** Marketplace base URL (e.g. https://exchange.inferlane.dev). */
  marketplaceUrl: string;
  /** API key (preferred). If absent, falls back to cookie auth via NEXTAUTH_SESSION_COOKIE. */
  apiKey?: string;
  /** NextAuth session cookie value, if using cookie auth (Phase 1 fallback). */
  sessionCookie?: string;
  /** This operator's user id on the marketplace. */
  operatorUserId: string;
  /** Capabilities — drives discovery + assessment. */
  capabilities: OperatorCapabilities;
  /** Local working directory for cloning + executing. */
  workspaceRoot: string;
  /** Polling interval in milliseconds for the loop command. */
  pollIntervalMs?: number;
}
