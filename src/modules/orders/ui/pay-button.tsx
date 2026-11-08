"use client";

import { useState } from "react";

import { IDEMPOTENCY_KEY_HEADER } from "@/shared/actions/action-types";
import { ActionButton } from "@/shared/ui/action-button";

// "Pagar" (D-040). ActionButton locks on the first click with one idempotency
// key per intent; the server creates the payment attempt, signs the Wompi
// checkout and the browser goes there. The payment is confirmed only by the
// Wompi webhook, never by coming back to the site.

const ERRORS: Record<string, string> = {
  insufficient_stock: "Uno de los productos se agotó mientras tanto. No se hizo ningún cobro.",
  payment_in_progress: "Ya tienes un pago en proceso. Espera la respuesta del banco antes de intentar de nuevo.",
  payment_order_not_payable: "Este pedido ya no se puede pagar.",
};

export function PayButton({ orderId }: { orderId: string }) {
  const [error, setError] = useState<string | null>(null);

  async function pay(idempotencyKey: string) {
    setError(null);
    const response = await fetch(`/api/orders/${orderId}/payments`, {
      method: "POST",
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    });
    const body = (await response.json().catch(() => ({}))) as {
      trackingId?: string;
      checkoutUrl?: string;
      error?: string;
    };
    if (response.status !== 202 || !body.trackingId || !body.checkoutUrl) {
      const message = (body.error && ERRORS[body.error]) ?? null;
      if (message) setError(message);
      throw new Error(body.error ?? "request_failed");
    }
    window.location.assign(body.checkoutUrl);
    return { trackingId: body.trackingId };
  }

  return (
    <div className="flex flex-col gap-2">
      <ActionButton onAccept={pay} className="w-full">Pagar con Wompi</ActionButton>
      {error ? (
        <p role="alert" className="notice notice-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
