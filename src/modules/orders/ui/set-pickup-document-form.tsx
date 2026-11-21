"use client";

import { useActionState, useId } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";

import { setPickupDocumentAction, type SetPickupDocumentState } from "../server/order-actions";

// A pickup order without a cédula yet (placed before step 18a, or turned into
// pickup when the 3 days passed): the customer gives it once (D-068).
export function SetPickupDocumentForm({ orderId }: { orderId: string }) {
  const id = useId();
  const [state, formAction] = useActionState<SetPickupDocumentState, FormData>(setPickupDocumentAction, {
    status: "idle",
  });
  return (
    <form action={formAction} className="card flex flex-col gap-3 p-5">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor={id} className="field-label">
        Cédula de quien recogerá el pedido
      </label>
      <input id={id} name="document" required inputMode="numeric" autoComplete="off" maxLength={20} className="field" />
      <p className="text-xs text-muted">Solo se registra una vez. Solo guardamos una huella y los 3 últimos dígitos.</p>
      <FormSubmitButton pendingLabel="Guardando…" className="w-full">
        Registrar cédula
      </FormSubmitButton>
      {state.message ? (
        <p role="status" className={state.status === "error" ? "text-sm text-danger" : "text-sm text-muted"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
