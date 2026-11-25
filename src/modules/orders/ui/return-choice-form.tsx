"use client";

import { useActionState, useId, useState } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";

import { RETURN_OPTION_LABELS, type ReturnOption } from "../domain/pickup";
import { chooseReturnOptionAction, type ReturnChoiceState } from "../server/order-actions";

// The customer's choice after a failed delivery (D-059, D-068). One choice,
// kept by the database; the button locks on the first click. Without a NIT,
// picking up needs the cédula of whoever goes. No animation (agents.md §8).
export function ReturnChoiceForm({ orderId, withNit }: { orderId: string; withNit: boolean }) {
  const id = useId();
  const [option, setOption] = useState<ReturnOption | "">("");
  const [state, formAction] = useActionState<ReturnChoiceState, FormData>(chooseReturnOptionAction, {
    status: "idle",
  });
  const options = Object.keys(RETURN_OPTION_LABELS) as ReturnOption[];

  return (
    <form action={formAction} className="card flex flex-col gap-3 p-5">
      <input type="hidden" name="orderId" value={orderId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="field-label mb-1">¿Qué prefieres?</legend>
        {options.map((value) => (
          <label key={value} className="option flex items-start gap-2">
            <input
              type="radio"
              name="option"
              value={value}
              required
              checked={option === value}
              onChange={() => setOption(value)}
            />
            <span>{RETURN_OPTION_LABELS[value]}</span>
          </label>
        ))}
      </fieldset>
      {option === "pickup" && !withNit ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-doc`} className="field-label">
            Cédula de quien recogerá el pedido
          </label>
          <input
            id={`${id}-doc`}
            name="document"
            required
            inputMode="numeric"
            autoComplete="off"
            maxLength={20}
            className="field"
          />
          <p className="text-xs text-muted">Con este número confirmarás la recogida. Solo guardamos una huella y los 3 últimos dígitos.</p>
        </div>
      ) : null}
      <FormSubmitButton pendingLabel="Guardando…" className="w-full">
        Guardar mi elección
      </FormSubmitButton>
      {state.message ? (
        <p role="status" className={state.status === "error" ? "text-sm text-danger" : "text-sm text-muted"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
