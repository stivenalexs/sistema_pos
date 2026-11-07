"use client";

import { useActionState } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";

import { type CancelOrderState, cancelOrderAction } from "../server/order-actions";

export function CancelOrderForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<CancelOrderState, FormData>(cancelOrderAction, {
    status: "idle",
  });

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <FormSubmitButton pendingLabel="Cancelando…">
        Cancelar pedido
      </FormSubmitButton>
      {state.message ? (
        <p role="status" className={state.status === "error" ? "text-red-700" : ""}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
