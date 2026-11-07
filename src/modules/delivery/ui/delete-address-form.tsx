"use client";

import { useActionState } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";

import { type AddressFormState, deleteAddressAction } from "../server/address-actions";

export function DeleteAddressForm({ addressId }: { addressId: string }) {
  const [state, formAction] = useActionState<AddressFormState, FormData>(deleteAddressAction, { status: "idle" });
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="addressId" value={addressId} />
      <FormSubmitButton pendingLabel="Borrando…" className="px-3 py-1 text-sm">
        Borrar
      </FormSubmitButton>
      {state.status === "error" ? <span className="text-sm text-red-700">{state.message}</span> : null}
    </form>
  );
}
