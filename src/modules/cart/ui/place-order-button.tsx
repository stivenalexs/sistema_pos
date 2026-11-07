"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { IDEMPOTENCY_KEY_HEADER } from "@/shared/actions/action-types";
import { ActionButton } from "@/shared/ui/action-button";

// "Confirmar pedido" (D-039). ActionButton locks on the first click and
// sends one idempotency key per intent; a double click or a second tab
// gets the same order.

const ERRORS: Record<string, string> = {
  cart_empty: "Tu carrito está vacío.",
  quote_failed: "Revisa las líneas marcadas en tu carrito.",
  insufficient_stock: "Uno de los productos ya no tiene unidades suficientes. Ajusta la cantidad.",
  order_requires_customer: "Inicia sesión con tu cuenta de cliente para comprar.",
  delivery_unavailable: "El domicilio a esa dirección no está disponible. Elige otra dirección o recoge en la tienda.",
  invalid_fulfillment: "Elige cómo quieres recibir el pedido.",
};

export type OrderFulfillment = { fulfillment: "pickup" } | { fulfillment: "delivery"; addressId: string };

export function PlaceOrderButton({ choice }: { choice: OrderFulfillment }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function placeOrder(idempotencyKey: string) {
    setError(null);
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      // Only the choice: the fee is computed by the server.
      body: JSON.stringify(choice),
    });
    const body = (await response.json().catch(() => ({}))) as {
      trackingId?: string;
      orderId?: string;
      error?: string;
    };
    if (response.status !== 202 || !body.trackingId || !body.orderId) {
      const message = (body.error && ERRORS[body.error]) ?? null;
      if (message) setError(message);
      throw new Error(body.error ?? "request_failed");
    }
    router.push(`/orders/${body.orderId}`);
    return { trackingId: body.trackingId };
  }

  return (
    <div className="flex flex-col gap-2">
      <ActionButton onAccept={placeOrder}>Confirmar pedido</ActionButton>
      {error ? (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
