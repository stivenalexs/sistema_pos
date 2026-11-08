"use client";

import { useActionState } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";

import { type AddressFormState, deleteAddressAction } from "../server/address-actions";

export function DeleteAddressForm({ addressId }: { addressId: string }) {
  const [state, formAction] = useActionState<AddressFormState, FormData>(deleteAddressAction, { status: "idle" });
  return (
    <form action={formAction} className="flex shrink-0 flex-col items-end gap-2">
      <input type="hidden" name="addressId" value={addressId} />
      <FormSubmitButton pendingLabel="Borrando…" variant="secondary" className="btn-sm">
        Borrar
      </FormSubmitButton>
      {state.status === "error" ? <span className="field-error">{state.message}</span> : null}
    </form>
  );
}
