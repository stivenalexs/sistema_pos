"use client";

import { useActionState, useId } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";

import { type ConfirmPickupState, confirmPickupAction } from "../server/order-actions";

// "Recogí mi pedido" (D-059, D-067). The customer confirms the pickup with the
// cédula given at order time, or with the company NIT. The button locks on the
// first click; repeating the confirmation leaves the same state. No animation
// (agents.md §8).
export function ConfirmPickupForm({ orderId, withNit }: { orderId: string; withNit: boolean }) {
  const fieldId = useId();
  const [state, formAction] = useActionState<ConfirmPickupState, FormData>(confirmPickupAction, {
    status: "idle",
  });
  const invalid = state.status === "error";

  return (
    <form action={formAction} className="card flex flex-col gap-3 p-5">
      <input type="hidden" name="orderId" value={orderId} />
      <label htmlFor={fieldId} className="field-label">
        {withNit ? "NIT de tu empresa" : "Cédula de quien recoge"}
      </label>
      <input
        id={fieldId}
        name="document"
        required
        inputMode="numeric"
        autoComplete="off"
        maxLength={20}
        className="field"
        aria-invalid={invalid || undefined}
        aria-describedby={state.message ? `${fieldId}-message` : undefined}
      />
      <FormSubmitButton pendingLabel="Confirmando…" className="w-full">
        Recogí mi pedido
      </FormSubmitButton>
      {state.message ? (
        <p
          id={`${fieldId}-message`}
          role="status"
          className={invalid ? "text-sm text-danger" : "text-sm text-muted"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
