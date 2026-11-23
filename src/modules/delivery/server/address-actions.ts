"use server";

import { refresh } from "next/cache";

import { readRaisedError, rpcFailureMessage } from "@/shared/supabase/rpc-result";
import { createSupabaseServerClient } from "@/shared/supabase/server";

import { ADDRESS_ERROR_MESSAGES, type FieldErrors, parseAddressInput } from "../domain/delivery";

// Saving and deleting addresses is synchronous and small: FormSubmitButton
// (frozen on the first click), like the cart (D-039).

export type AddressFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
  fieldErrors?: FieldErrors;
};

function knownMessage(message: string, fallback: string): string {
  return rpcFailureMessage(readRaisedError({ message }, ADDRESS_ERROR_MESSAGES)!, ADDRESS_ERROR_MESSAGES, fallback);
}

export async function saveAddressAction(
  _previous: AddressFormState,
  formData: FormData,
): Promise<AddressFormState> {
  const parsed = parseAddressInput({
    label: formData.get("label"),
    addressLine: formData.get("addressLine"),
    details: formData.get("details"),
    zoneId: formData.get("zoneId"),
    lat: formData.get("lat"),
    lng: formData.get("lng"),
  });
  if (!parsed.ok) {
    return { status: "error", message: "Revisa los campos marcados.", fieldErrors: parsed.errors };
  }

  const { value } = parsed;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_delivery_address", {
    p_label: value.label,
    p_address_line: value.addressLine,
    // The function accepts null; the generated types mark it as string.
    p_details: value.details as string,
    p_zone_id: value.zoneId,
    p_lat: value.lat,
    p_lng: value.lng,
  });
  if (error) {
    return { status: "error", message: knownMessage(error.message, "No pudimos guardar la dirección. Intenta de nuevo.") };
  }
  refresh();
  return { status: "ok", message: "Dirección guardada." };
}

export async function deleteAddressAction(
  _previous: AddressFormState,
  formData: FormData,
): Promise<AddressFormState> {
  const addressId = formData.get("addressId");
  if (typeof addressId !== "string") return { status: "error", message: "Dirección no válida." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delete_delivery_address", { p_address_id: addressId });
  if (error) return { status: "error", message: "No pudimos borrar la dirección. Intenta de nuevo." };
  refresh();
  return { status: "ok", message: "Dirección borrada." };
}
