"use client";

import { useActionState } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";

import { type CartFormState, setCartItemAction } from "../server/cart-actions";

type Props = {
  productId: string;
  minQuantity: number;
  unitLabel: string;
  /** Submit label, e.g. "Agregar al carrito" or "Actualizar". */
  submitLabel?: string;
  defaultQuantity?: number;
};

export function AddToCartForm({
  productId,
  minQuantity,
  unitLabel,
  submitLabel = "Agregar al carrito",
  defaultQuantity,
}: Props) {
  const [state, formAction] = useActionState<CartFormState, FormData>(setCartItemAction, {
    status: "idle",
  });

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="productId" value={productId} />
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Cantidad ({unitLabel})
        <input
          type="number"
          name="quantity"
          required
          min={submitLabel === "Agregar al carrito" ? minQuantity : 0}
          max={10000}
          step={1}
          defaultValue={defaultQuantity ?? minQuantity}
          className="field w-24 min-h-10 py-1.5"
        />
      </label>
      <FormSubmitButton pendingLabel="Guardando…" className="btn-sm flex-1">
        {submitLabel}
      </FormSubmitButton>
      {state.message ? (
        <p role="status" className={`w-full text-xs ${state.status === "error" ? "text-danger" : "text-success"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
