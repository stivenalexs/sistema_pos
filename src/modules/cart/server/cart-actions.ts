"use server";

import { refresh } from "next/cache";

import { createSupabaseServerClient } from "@/shared/supabase/server";

// Cart changes (D-039). Synchronous and small, so they use FormSubmitButton
// (frozen on the first click) instead of the queue, like the auth forms (D-035).

export type CartFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
};

const MESSAGES: Record<string, string> = {
  cart_requires_customer: "Inicia sesión con tu cuenta de cliente para comprar.",
  cart_invalid_quantity: "La cantidad no es válida.",
  cart_unknown_product: "Este producto ya no está disponible.",
  cart_too_many_items: "Tu carrito tiene demasiados productos.",
};

function toQuantity(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d{1,5}$/.test(value.trim())) return null;
  return Number.parseInt(value, 10);
}

export async function setCartItemAction(
  _previous: CartFormState,
  formData: FormData,
): Promise<CartFormState> {
  const productId = formData.get("productId");
  const quantity = toQuantity(formData.get("quantity"));
  if (typeof productId !== "string" || quantity === null) {
    return { status: "error", message: MESSAGES.cart_invalid_quantity };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_cart_item", {
    p_product_id: productId,
    p_quantity: quantity,
  });
  if (error) {
    const known = Object.keys(MESSAGES).find((code) => error.message.includes(code));
    return {
      status: "error",
      message: known ? MESSAGES[known] : "No pudimos actualizar el carrito. Intenta de nuevo.",
    };
  }
  // Re-render the current page with the new data (totals, status).
  refresh();
  return {
    status: "ok",
    message: quantity === 0 ? "Producto quitado." : "Carrito actualizado.",
  };
}
