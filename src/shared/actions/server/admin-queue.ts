"use server";

import { refresh } from "next/cache";

import { createSupabaseServerClient } from "@/shared/supabase/server";
import type { ReasonFormState } from "@/shared/ui/reason-action-form";

// Queue health and retries for the admin panel (D-055). Runs with the
// administrator's session; the database checks the role.

export type FailedAction = {
  id: string;
  type: string;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  payload: unknown;
  finishedAt: string | null;
};

export type QueueStatus = { failed: FailedAction[]; overdue: number; stalled: number; queued: number; failedCount: number };

export async function getQueueStatus(): Promise<QueueStatus> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_queue_status");
  if (error) throw new Error(`admin_queue_status failed: ${error.message}`);
  const raw = data as {
    failed: { id: string; type: string; error: string | null; attempts: number; max_attempts: number; payload: unknown; finished_at: string | null }[];
    overdue: number;
    stalled: number;
    queued: number;
    failed_count: number;
  };
  return {
    failed: raw.failed.map((a) => ({
      id: a.id,
      type: a.type,
      error: a.error,
      attempts: a.attempts,
      maxAttempts: a.max_attempts,
      payload: a.payload,
      finishedAt: a.finished_at,
    })),
    overdue: raw.overdue,
    stalled: raw.stalled,
    queued: raw.queued,
    failedCount: raw.failed_count,
  };
}

const MESSAGES: Record<string, string> = {
  admin_forbidden: "Solo un administrador puede hacer esto.",
  invalid_reason: "Escribe el motivo (entre 3 y 300 caracteres).",
  action_not_found: "No encontramos esa acción.",
  action_not_failed: "Esa acción ya no está fallida.",
  delivery_proof_data_removed:
    "Esta confirmación de entrega ya no guarda la cédula de quien recibió. Pide al mensajero que la envíe de nuevo.",
};

export async function retryActionAction(_previous: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  const id = formData.get("actionId");
  const reason = formData.get("reason");
  if (typeof id !== "string" || typeof reason !== "string") return { status: "error", message: MESSAGES.invalid_reason };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("retry_action", { p_action_id: id, p_reason: reason.trim() });
  const code = error ? Object.keys(MESSAGES).find((k) => error.message.includes(k)) : (data as { ok: boolean; error?: string }).ok ? null : (data as { error?: string }).error;
  if (error || code) return { status: "error", message: (code && MESSAGES[code]) ?? "No se pudo reintentar." };
  refresh();
  return { status: "ok", message: "Acción encolada de nuevo." };
}
