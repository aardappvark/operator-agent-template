/**
 * Typed marketplace API client.
 *
 * Auth: prefers `apiKey` if provided (sent as `Authorization: Bearer <key>`).
 * Falls back to `sessionCookie` (NextAuth session) for Phase 1, while the
 * marketplace doesn't yet expose API keys for headless agents. Once API
 * keys ship, drop the cookie path.
 *
 * Every method validates the response shape with zod. If the marketplace
 * returns something the client doesn't expect, callers get a typed error
 * rather than a downstream crash deep in their code.
 */

import { z } from 'zod';
import { TaskSchema, type Task, type AgentConfig } from './types.js';

export class MarketplaceClient {
  constructor(private cfg: AgentConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.apiKey) {
      h['authorization'] = `Bearer ${this.cfg.apiKey}`;
    } else if (this.cfg.sessionCookie) {
      h['cookie'] = this.cfg.sessionCookie;
    } else {
      throw new MarketplaceClientError(
        'NO_AUTH',
        'Provide AgentConfig.apiKey or AgentConfig.sessionCookie. Marketplace endpoints reject anonymous calls.',
      );
    }
    return h;
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
    schema?: z.ZodType<T>,
  ): Promise<T> {
    const url = `${this.cfg.marketplaceUrl}${path}`;
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: this.headers(),
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new MarketplaceClientError(
        'NON_JSON_RESPONSE',
        `${init.method ?? 'GET'} ${path} → ${res.status}: response was not JSON`,
        { status: res.status },
      );
    }

    if (!res.ok) {
      const body = json as { error?: string; message?: string; details?: unknown };
      throw new MarketplaceClientError(
        body.error ?? `HTTP_${res.status}`,
        body.message ?? `${init.method ?? 'GET'} ${path} failed with ${res.status}`,
        { status: res.status, details: body.details },
      );
    }

    if (!schema) return json as T;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new MarketplaceClientError(
        'RESPONSE_SHAPE_MISMATCH',
        `Response from ${path} did not match expected schema: ${parsed.error.message}`,
        { rawResponse: json },
      );
    }
    return parsed.data;
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  /**
   * List open tasks. Supports filtering by category + tier on the server side
   * (Phase 1 implementation may be naive; client filters down further in
   * discovery.ts after this returns).
   */
  async listOpenTasks(params: {
    category?: string;
    minBountyUsd?: number;
    limit?: number;
  } = {}): Promise<Task[]> {
    const qp = new URLSearchParams({ status: 'open' });
    if (params.category) qp.set('category', params.category);
    if (params.minBountyUsd != null) qp.set('minBountyUsd', String(params.minBountyUsd));
    if (params.limit != null) qp.set('limit', String(params.limit));

    const ListResp = z.object({ tasks: z.array(TaskSchema) });
    const r = await this.request(`/api/exchange/tasks?${qp.toString()}`, {}, ListResp);
    return r.tasks;
  }

  async getTask(taskId: string): Promise<Task> {
    const TaskResp = z.object({ task: TaskSchema });
    const r = await this.request(`/api/exchange/tasks/${taskId}`, {}, TaskResp);
    return r.task;
  }

  // ---------------------------------------------------------------------------
  // Application
  // ---------------------------------------------------------------------------

  /**
   * Apply to a task. Takes the operator-friendly shape (hours / USD /
   * free-form notes) and translates to the server's contract before
   * sending: hours → minutes, `estimatedCostUsd` → `estimatedTokenCostUsd`,
   * `notes` → `applicationMessage`. `estimatedHours` is REQUIRED — the
   * server's `estimatedCompletionMinutes` field is required.
   *
   * If you call this with the old (pre-fix) shape sending hours without
   * conversion, the marketplace will return 400 Invalid request body.
   * This wrapper is the canonical path.
   */
  async apply(
    taskId: string,
    body: {
      estimatedHours: number;
      estimatedCostUsd?: number;
      skillPackId?: string;
      notes?: string;
    },
  ): Promise<{ applicationId: string }> {
    // Translate operator-facing shape → server contract.
    const serverBody: {
      estimatedCompletionMinutes: number;
      estimatedTokenCostUsd?: number;
      skillPackId?: string;
      applicationMessage?: string;
    } = {
      estimatedCompletionMinutes: Math.max(1, Math.round(body.estimatedHours * 60)),
    };
    if (body.estimatedCostUsd != null) serverBody.estimatedTokenCostUsd = body.estimatedCostUsd;
    if (body.skillPackId) serverBody.skillPackId = body.skillPackId;
    if (body.notes) serverBody.applicationMessage = body.notes;

    const ApplyResp = z.object({
      application: z.object({
        id: z.string(),
        taskId: z.string(),
      }),
    });
    const r = await this.request(
      `/api/exchange/tasks/${taskId}/apply`,
      { method: 'POST', body: serverBody },
      ApplyResp,
    );
    return { applicationId: r.application.id };
  }

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  async submit(
    taskId: string,
    body: {
      prUrl?: string;
      diffBlobUrl?: string;
      executionAttestation: object;
      operatorSelfAssessment?: string;
      mechanicalGatesResults: object;
      skillPackId?: string;
    },
  ): Promise<{ submissionId: string; mechanicalGatesPassed: boolean; taskStatus: string }> {
    const SubmitResp = z.object({
      submission: z.object({
        id: z.string(),
        mechanicalGatesPassed: z.boolean(),
      }),
      taskStatus: z.string(),
    });
    const r = await this.request(
      `/api/exchange/tasks/${taskId}/submit`,
      { method: 'POST', body },
      SubmitResp,
    );
    return {
      submissionId: r.submission.id,
      mechanicalGatesPassed: r.submission.mechanicalGatesPassed,
      taskStatus: r.taskStatus,
    };
  }
}

export class MarketplaceClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MarketplaceClientError';
  }
}
