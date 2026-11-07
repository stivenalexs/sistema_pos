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
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="productId" value={productId} />
      <label className="flex items-center gap-2 text-sm">
        Cantidad
        <input
          type="number"
          name="quantity"
          required
          min={submitLabel === "Agregar al carrito" ? minQuantity : 0}
          max={10000}
          step={1}
          defaultValue={defaultQuantity ?? minQuantity}
          className="w-20 rounded-md border border-neutral-400 px-2 py-1"
        />
        <span className="text-neutral-600">{unitLabel}</span>
      </label>
      <FormSubmitButton pendingLabel="Guardando…" className="px-3 py-1 text-sm">
        {submitLabel}
      </FormSubmitButton>
      {state.message ? (
        <p role="status" className={state.status === "error" ? "text-sm text-red-700" : "text-sm"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
