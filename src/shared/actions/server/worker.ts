import "server-only";

import type { Json } from "@/shared/supabase/database.types";

// Generic worker for the actions queue (D-034). The handlers are registered by
// the app layer (src/app/api/workers/actions/handlers.ts), so this file does
// not depend on any business module.

export type ClaimedAction = {
  actionId: string;
  type: string;
  userId: string | null;
  payload: Json;
  attempt: number;
  maxAttempts: number;
};

export type ActionHandler = (action: ClaimedAction) => Promise<Json>;

export type ActionHandlers = Readonly<Record<string, ActionHandler>>;

/**
 * Throw this from a handler when retrying cannot help (invalid payload, a
 * business rule that rejects the action). The action fails at once.
 */
export class PermanentActionError extends Error {
  override name = "PermanentActionError";
}

export interface ActionQueue {
  claim(batch: number, visibilitySeconds: number): Promise<ClaimedAction[]>;
  complete(actionId: string, result: Json): Promise<void>;
  fail(actionId: string, error: string, permanent: boolean): Promise<void>;
}

export type WorkerReport = {
  claimed: number;
  succeeded: number;
  failed: number;
};

export type WorkerOptions = {
  /** Most actions taken in one call. */
  maxActions?: number;
  /** How long a claimed message stays hidden from other workers. */
  visibilitySeconds?: number;
  /** No new action is claimed after this time; the next call goes on. */
  timeBudgetMs?: number;
  now?: () => number;
};

/**
 * Processes queued actions ONE AT A TIME (D-073): an action is claimed only
 * when the previous one ended, so a slow handler never leaves other claimed
 * actions waiting while their visibility runs out (with a batch, they
 * reappeared and a second worker ran them too). The database also refuses
 * to hand out again an action still being processed (claim_actions).
 *
 * Handlers must be idempotent: if the process dies after the side effect but
 * before complete(), the action runs again.
 */
export async function runActionsWorker(
  queue: ActionQueue,
  handlers: ActionHandlers,
  options: WorkerOptions = {},
): Promise<WorkerReport> {
  const maxActions = options.maxActions ?? 10;
  const visibilitySeconds = options.visibilitySeconds ?? 120;
  const timeBudgetMs = options.timeBudgetMs ?? 50_000;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const report: WorkerReport = { claimed: 0, succeeded: 0, failed: 0 };

  while (report.claimed < maxActions && now() - startedAt < timeBudgetMs) {
    const [action] = await queue.claim(1, visibilitySeconds);
    if (!action) break;
    report.claimed += 1;

    const handler = Object.hasOwn(handlers, action.type)
      ? handlers[action.type]
      : undefined;

    if (!handler) {
      await queue.fail(action.actionId, `unknown_action_type: ${action.type}`, true);
      report.failed += 1;
      continue;
    }

    try {
      const result = await handler(action);
      await queue.complete(action.actionId, result);
      report.succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await queue.fail(
        action.actionId,
        message,
        error instanceof PermanentActionError,
      );
      report.failed += 1;
    }
  }

  return report;
}
