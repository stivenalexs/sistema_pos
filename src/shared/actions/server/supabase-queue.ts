import "server-only";

import { createSupabaseAdminClient } from "@/shared/supabase/admin";

import type { ActionQueue } from "./worker";

/** ActionQueue backed by the SQL functions of the actions migration. */
export function createSupabaseActionQueue(
  admin = createSupabaseAdminClient(),
): ActionQueue {
  return {
    async claim(batch, visibilitySeconds) {
      const { data, error } = await admin.rpc("claim_actions", {
        p_batch: batch,
        p_visibility_seconds: visibilitySeconds,
      });
      if (error) throw new Error(`claim_actions failed: ${error.message}`);
      return (data ?? []).map((row) => ({
        actionId: row.action_id,
        type: row.type,
        userId: row.user_id,
        payload: row.payload,
        attempt: row.attempt,
        maxAttempts: row.max_attempts,
      }));
    },
    async complete(actionId, result) {
      const { error } = await admin.rpc("complete_action", {
        p_action_id: actionId,
        p_result: result,
      });
      if (error) throw new Error(`complete_action failed: ${error.message}`);
    },
    async fail(actionId, message, permanent) {
      const { error } = await admin.rpc("fail_action", {
        p_action_id: actionId,
        p_error: message,
        p_permanent: permanent,
      });
      if (error) throw new Error(`fail_action failed: ${error.message}`);
    },
  };
}
