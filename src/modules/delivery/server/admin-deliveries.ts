"use server";

import { refresh } from "next/cache";

import { createSupabaseServerClient } from "@/shared/supabase/server";
import type { IdempotentFormState } from "@/shared/ui/idempotent-form-state";

import { ASSIGNMENT_ERROR_MESSAGES, type FailureReason, parseAssignment } from "../domain/delivery";

// Delivery assignment from the admin panel (D-045, D-057). assign_delivery
// checks the admin role, the order state and the courier; this only parses
// and translates. Assigning again is allowed (reassignment), so it needs no
// idempotency key: the same assignment twice leaves the same state.

export type AdminDelivery = {
  orderId: string;
  status: "paid" | "preparing" | "out_for_delivery";
  paidAt: string | null;
  totalCop: number;
  totalUnits: number;
  municipality: string;
  addressLine: string;
  details: string | null;
  contactName: string | null;
  contactPhone: string | null;
  distanceM: number;
  providerId: string | null;
  provider: string | null;
  providerKind: "own" | "third_party" | null;
  courierId: string | null;
  courier: string | null;
  externalRef: string | null;
  assignedAt: string | null;
  lastFailure: { reason: FailureReason; notes: string | null; at: string } | null;
  /** Failed delivery back at the store (D-068). */
  returnKind: "customer" | "force_majeure" | "underage" | null;
  returnedAt: string | null;
  returnChoice: "pickup" | "reschedule" | "refund" | null;
  returnChoiceDeadline: string | null;
  /** Waiting for the customer's choice: not assignable. */
  awaitingChoice: boolean;
  /** Day (Colombia, YYYY-MM-DD) a rescheduled delivery should go out. */
  scheduledDeliveryOn: string | null;
};

export async function listDeliveriesForAdmin(): Promise<AdminDelivery[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_deliveries");
  if (error) throw new Error(`admin_list_deliveries failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    orderId: r.order_id as string,
    status: r.status as AdminDelivery["status"],
    paidAt: (r.paid_at as string | null) ?? null,
    totalCop: r.total_cop as number,
    totalUnits: r.total_units as number,
    municipality: (r.municipality as string | null) ?? "",
    addressLine: (r.address_line as string | null) ?? "",
    details: (r.details as string | null) ?? null,
    contactName: (r.contact_name as string | null) ?? null,
    contactPhone: (r.contact_phone as string | null) ?? null,
    distanceM: r.distance_m as number,
    providerId: (r.provider_id as string | null) ?? null,
    provider: (r.provider as string | null) ?? null,
    providerKind: (r.provider_kind as AdminDelivery["providerKind"]) ?? null,
    courierId: (r.courier_id as string | null) ?? null,
    courier: (r.courier as string | null) ?? null,
    externalRef: (r.external_ref as string | null) ?? null,
    assignedAt: (r.assigned_at as string | null) ?? null,
    lastFailure: (r.last_failure as AdminDelivery["lastFailure"]) ?? null,
    returnKind: (r.return_kind as AdminDelivery["returnKind"]) ?? null,
    returnedAt: (r.returned_at as string | null) ?? null,
    returnChoice: (r.return_choice as AdminDelivery["returnChoice"]) ?? null,
    returnChoiceDeadline: (r.return_choice_deadline as string | null) ?? null,
    awaitingChoice: r.awaiting_choice === true,
    scheduledDeliveryOn: (r.scheduled_delivery_on as string | null) ?? null,
  }));
}

export type DeliveryProvider = { id: string; name: string; kind: "own" | "third_party"; isActive: boolean };
export type AdminCourier = { id: string; name: string; phone: string | null; providerId: string };

export async function getDeliveryOptions(): Promise<{ providers: DeliveryProvider[]; couriers: AdminCourier[] }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_delivery_options");
  if (error) throw new Error(`admin_list_delivery_options failed: ${error.message}`);
  const row = data as {
    providers: { id: string; name: string; kind: "own" | "third_party"; is_active: boolean }[];
    couriers: { id: string; name: string; phone: string | null; provider_id: string }[];
  };
  return {
    providers: row.providers.map((p) => ({ id: p.id, name: p.name, kind: p.kind, isActive: p.is_active })),
    couriers: row.couriers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, providerId: c.provider_id })),
  };
}

function answer(
  previous: IdempotentFormState,
  status: "ok" | "error",
  message: string,
  values?: Record<string, string>,
): IdempotentFormState {
  return { status, message, values, answer: (previous.answer ?? 0) + 1 };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function assignDeliveryAction(previous: IdempotentFormState, formData: FormData): Promise<IdempotentFormState> {
  const values = { assignment: text(formData, "assignment"), externalRef: text(formData, "externalRef") };
  const orderId = text(formData, "orderId");
  const choice = parseAssignment(values.assignment);
  if (!choice) return answer(previous, "error", "Elige un mensajero o un proveedor.", values);
  if (values.externalRef.length > 100) {
    return answer(previous, "error", "La guía puede tener hasta 100 caracteres.", values);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("assign_delivery", {
    p_order_id: orderId,
    p_provider_id: choice.providerId,
    p_courier_id: choice.courierId ?? undefined,
    // A guide belongs to a third party only. The field keeps the previous
    // third party's guide when reassigning to an own courier: it is dropped
    // (assign_delivery then clears it) instead of rejecting the form.
    p_external_ref: (!choice.courierId && values.externalRef) || undefined,
  });
  if (error) {
    const code = Object.keys(ASSIGNMENT_ERROR_MESSAGES).find((k) => error.message.includes(k));
    return answer(previous, "error", (code && ASSIGNMENT_ERROR_MESSAGES[code]) ?? "No se pudo asignar.", values);
  }
  refresh();
  return answer(previous, "ok", "Domicilio asignado: el pedido quedó en camino.");
}

export async function createProviderAction(previous: IdempotentFormState, formData: FormData): Promise<IdempotentFormState> {
  const name = text(formData, "name");
  if (name.length < 3 || name.length > 80) {
    return answer(previous, "error", "Escribe el nombre de la empresa (entre 3 y 80 caracteres).", { name });
  }
  const supabase = await createSupabaseServerClient();
  // RLS: only the administrator inserts providers; a trigger records the change.
  const { error } = await supabase.from("delivery_providers").insert({ name, kind: "third_party" });
  if (error) {
    const message = error.code === "23505" ? "Ya existe un proveedor con ese nombre." : "No se pudo crear el proveedor.";
    return answer(previous, "error", message, { name });
  }
  refresh();
  return answer(previous, "ok", `Proveedor «${name}» creado.`);
}

export async function setProviderActiveAction(
  previous: IdempotentFormState,
  formData: FormData,
): Promise<IdempotentFormState> {
  const providerId = text(formData, "providerId");
  const active = text(formData, "active") === "true";
  const supabase = await createSupabaseServerClient();
  // Only third parties: the own couriers' provider stays active.
  const { data, error } = await supabase
    .from("delivery_providers")
    .update({ is_active: active })
    .eq("id", providerId)
    .eq("kind", "third_party")
    .select("id");
  if (error || !data?.length) return answer(previous, "error", "No se pudo cambiar el proveedor.");
  refresh();
  return answer(previous, "ok", active ? "Proveedor activado." : "Proveedor desactivado.");
}
