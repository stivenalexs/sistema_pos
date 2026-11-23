import "server-only";

import {
  acceptAction,
  IdempotencyConflictError,
} from "@/shared/actions/server/accept-action";
import { PermanentActionError } from "@/shared/actions/server/worker";
import { getStaffSessionIn, type StaffSession } from "@/shared/auth/staff-session";
import { createSupabaseAdminClient } from "@/shared/supabase/admin";
import { readRpcResult } from "@/shared/supabase/rpc-result";
import { createSupabaseServerClient } from "@/shared/supabase/server";
import type { Database, Json } from "@/shared/supabase/database.types";

import { isValidSignaturePng, parseProofInput, signaturePath } from "../domain/proof";

// Courier side of the delivery (D-007, D-026, D-045).
// - Reads run with the user's session: RLS shows a courier only the orders
//   assigned to them; an administrator sees all of them.
// - Confirming is an async action: the endpoint checks the session, the
//   assignment and the form, uploads the signature with the user's session
//   (storage policy: only for assigned orders), enqueues and answers 202.
//   The worker records the attempt atomically in the database.

export const SIGNATURES_BUCKET = "delivery-signatures";

export const DELIVERY_ROLES = ["courier", "admin"] as const;

export type DeliveryStaffRole = (typeof DELIVERY_ROLES)[number];

/** The internal role of the signed-in user, if it can deliver orders. */
export async function getDeliveryStaff(): Promise<StaffSession<DeliveryStaffRole> | null> {
  return getStaffSessionIn(DELIVERY_ROLES);
}

export type DeliveryAddressSnapshot = {
  label: string;
  address_line: string;
  details: string | null;
  municipality: string;
  lat: number;
  lng: number;
  contact_name: string | null;
  contact_phone: string | null;
};

export type CourierDelivery = {
  orderId: string;
  status: string;
  totalCop: number;
  address: DeliveryAddressSnapshot;
  distanceM: number | null;
  assignedAt: string | null;
  items: { productName: string; quantity: number; saleUnit: string; unitsPerBox: number }[];
};

const SELECT =
  "id, status, total_cop, delivery_address, delivery_distance_m, assigned_at, order_items (product_name, quantity, sale_unit, units_per_box)";

type Row = {
  id: string;
  status: string;
  total_cop: number;
  delivery_address: Json | null;
  delivery_distance_m: number | null;
  assigned_at: string | null;
  order_items: { product_name: string; quantity: number; sale_unit: string; units_per_box: number }[];
};

function toDelivery(row: Row): CourierDelivery {
  return {
    orderId: row.id,
    status: row.status,
    totalCop: row.total_cop,
    address: row.delivery_address as unknown as DeliveryAddressSnapshot,
    distanceM: row.delivery_distance_m,
    assignedAt: row.assigned_at,
    items: row.order_items.map((item) => ({
      productName: item.product_name,
      quantity: item.quantity,
      saleUnit: item.sale_unit,
      unitsPerBox: item.units_per_box,
    })),
  };
}

/** Orders on their way: the courier's own, or all of them for an admin. */
export async function listCourierDeliveries(staff: { userId: string; role: DeliveryStaffRole }): Promise<CourierDelivery[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("orders")
    .select(SELECT)
    .eq("fulfillment", "delivery")
    .eq("status", "out_for_delivery")
    .order("assigned_at", { ascending: true });
  if (staff.role === "courier") query = query.eq("courier_id", staff.userId);
  const { data, error } = await query;
  if (error) throw new Error(`courier deliveries failed: ${error.message}`);
  return (data as Row[]).map(toDelivery);
}

export async function getCourierDelivery(orderId: string): Promise<CourierDelivery | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("orders")
    .select(SELECT)
    .eq("id", orderId)
    .eq("fulfillment", "delivery")
    .maybeSingle();
  return data ? toDelivery(data as Row) : null;
}

export type ConfirmDeliveryResult =
  | { ok: true; trackingId: string }
  | { ok: false; status: 400 | 403 | 409 | 413; error: string };

/** The route's body reader: the form, or why it could not be read. */
export type DeliveryFormReader = () => Promise<
  { ok: true; form: FormData } | { ok: false; status: 400 | 413; error: string }
>;

/**
 * Validates and accepts a delivery attempt (delivered or failed). The route
 * passes how to read its multipart body: it is read only AFTER the session
 * is known to belong to a courier or an administrator (D-074), so nobody
 * else makes the server read a body at all.
 */
export async function acceptDeliveryAttempt(input: {
  orderId: string;
  idempotencyKey: string;
  readForm: DeliveryFormReader;
}): Promise<ConfirmDeliveryResult> {
  const staff = await getDeliveryStaff();
  if (!staff) return { ok: false, status: 403, error: "delivery_forbidden" };

  const body = await input.readForm();
  if (!body.ok) return body;
  const form = body.form;

  const parsed = parseProofInput({
    outcome: form.get("outcome"),
    recipientName: form.get("recipientName"),
    documentNumber: form.get("documentNumber"),
    ageConfirmed: form.get("ageConfirmed"),
    failureReason: form.get("failureReason"),
    notes: form.get("notes"),
  });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const { data: allowed, error: checkError } = await supabase.rpc("can_deliver_order", { p_order_id: input.orderId });
  if (checkError) throw new Error(`can_deliver_order failed: ${checkError.message}`);
  if (!allowed) return { ok: false, status: 409, error: "order_not_out_for_delivery" };

  const proof = parsed.value;
  let path: string | null = null;
  if (proof.outcome === "delivered") {
    const file = form.get("signature");
    if (!(file instanceof Blob)) return { ok: false, status: 400, error: "signature_missing" };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isValidSignaturePng(bytes)) return { ok: false, status: 400, error: "signature_missing" };

    // One object per intent: a retry with the same key finds it already there.
    path = signaturePath(input.orderId, input.idempotencyKey);
    const { error: uploadError } = await supabase.storage
      .from(SIGNATURES_BUCKET)
      .upload(path, bytes, { contentType: "image/png", upsert: false });
    if (uploadError && !/exist|duplicate/i.test(uploadError.message)) {
      throw new Error(`signature upload failed: ${uploadError.message}`);
    }
  }

  try {
    const action = await acceptAction({
      idempotencyKey: input.idempotencyKey,
      type: "confirm_delivery",
      userId: staff.userId,
      payload: {
        order_id: input.orderId,
        attempt_key: input.idempotencyKey,
        outcome: proof.outcome,
        recipient_name: proof.outcome === "delivered" ? proof.recipientName : null,
        document_number: proof.outcome === "delivered" ? proof.documentNumber : null,
        age_confirmed: proof.outcome === "delivered",
        failure_reason: proof.outcome === "failed" ? proof.failureReason : null,
        notes: proof.notes,
        signature_path: path,
      },
    });
    return { ok: true, trackingId: action.trackingId };
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return { ok: false, status: 409, error: "idempotency_key_conflict" };
    }
    throw error;
  }
}

type ConfirmPayload = {
  order_id: string;
  attempt_key: string;
  outcome: "delivered" | "failed";
  recipient_name: string | null;
  document_number: string | null;
  age_confirmed: boolean;
  failure_reason: string | null;
  notes: string | null;
  signature_path: string | null;
};

function isConfirmPayload(value: unknown): value is ConfirmPayload {
  const p = value as Partial<ConfirmPayload> | null;
  return (
    !!p &&
    typeof p.order_id === "string" &&
    typeof p.attempt_key === "string" &&
    (p.outcome === "delivered" || p.outcome === "failed")
  );
}

type RecordArgs = Database["public"]["Functions"]["record_delivery_attempt"]["Args"];
type RecordRpc = (args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

function defaultRecord(): RecordRpc {
  const admin = createSupabaseAdminClient();
  return async (args) => {
    // The generated types mark every argument as non-null, but the function
    // accepts null for the fields that do not apply to the outcome.
    const { data, error } = await admin.rpc("record_delivery_attempt", args as unknown as RecordArgs);
    return { data, error };
  };
}

/**
 * Worker job "confirm_delivery". Idempotent: the database keys the attempt by
 * the intent's key, so running it twice records it once.
 */
export async function processDeliveryAttempt(
  actorId: string | null,
  payload: unknown,
  record: RecordRpc = defaultRecord(),
): Promise<Json> {
  if (!actorId || !isConfirmPayload(payload)) throw new PermanentActionError("invalid_payload");

  const { data, error } = await record({
    p_idempotency_key: payload.attempt_key,
    p_order_id: payload.order_id,
    p_actor_id: actorId,
    p_outcome: payload.outcome,
    p_recipient_name: payload.recipient_name,
    p_document_number: payload.document_number,
    p_age_confirmed: payload.age_confirmed,
    p_signature_path: payload.signature_path,
    p_failure_reason: payload.failure_reason,
    p_notes: payload.notes,
  });
  if (error) {
    if (error.message.includes("idempotency_key_conflict")) throw new PermanentActionError("idempotency_key_conflict");
    throw new Error(`record_delivery_attempt failed: ${error.message}`);
  }
  const result = readRpcResult<{ outcome?: string; attempt_id?: string }>({ data, error: null }, {});
  if (!result.ok) throw new PermanentActionError(result.code ?? "delivery_rejected");
  return { outcome: result.value.outcome ?? payload.outcome, attempt_id: result.value.attempt_id ?? null };
}
