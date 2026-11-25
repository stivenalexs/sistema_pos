"use server";

import { refresh } from "next/cache";

import { readRpcResult, rpcFailureMessage } from "@/shared/supabase/rpc-result";
import { createSupabaseServerClient } from "@/shared/supabase/server";
import type { ReasonFormState } from "@/shared/ui/reason-action-form";

// Pickups the store must resolve (D-067, D-068): locked after five wrong
// documents, or still without a cédula. Admin only (checked in the database).

export type PickupAttention = {
  orderId: string;
  status: string;
  customer: string;
  paidAt: string | null;
  totalCop: number;
  reason: "locked" | "missing_document";
  failedAttempts: number;
  /** Became a pickup because the customer did not choose in 3 days. */
  defaulted: boolean;
};

export async function listPickupsAttention(): Promise<PickupAttention[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_pickups_attention");
  if (error) throw new Error(`admin_list_pickups_attention failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    orderId: r.order_id as string,
    status: r.status as string,
    customer: r.customer as string,
    paidAt: (r.paid_at as string | null) ?? null,
    totalCop: r.total_cop as number,
    reason: r.reason as PickupAttention["reason"],
    failedAttempts: r.failed_attempts as number,
    defaulted: r.defaulted === true,
  }));
}

const RESET_MESSAGES: Record<string, string> = {
  admin_forbidden: "Solo un administrador puede hacer esto.",
  invalid_reason: "Escribe el motivo (entre 3 y 300 caracteres).",
  order_not_found: "No encontramos ese pedido para recoger.",
};

/** Unlocks a pickup after five wrong documents; the reason goes to the order history. */
export async function resetPickupAttemptsAction(_previous: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  const orderId = formData.get("orderId");
  const reason = formData.get("reason");
  if (typeof orderId !== "string" || typeof reason !== "string") {
    return { status: "error", message: RESET_MESSAGES.invalid_reason };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_reset_pickup_attempts", {
    p_order_id: orderId,
    p_reason: reason.trim(),
  });
  const result = readRpcResult({ data, error }, RESET_MESSAGES);
  if (!result.ok) return { status: "error", message: rpcFailureMessage(result, RESET_MESSAGES, "No se pudo reiniciar.") };
  refresh();
  return { status: "ok", message: "Intentos reiniciados. El cliente ya puede confirmar la recogida." };
}
