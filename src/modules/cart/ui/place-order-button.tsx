"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { normalizeIdDocument } from "@/shared/id-document";

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
  sales_blocked: "Las ventas están suspendidas en este momento. Tu carrito queda guardado; recarga la página para ver hasta cuándo.",
  pickup_document_required: "Escribe la cédula de quien recogerá el pedido.",
  invalid_pickup_document: "La cédula debe tener de 5 a 12 dígitos.",
};

export type OrderFulfillment = { fulfillment: "pickup" } | { fulfillment: "delivery"; addressId: string };

// needsPickupDocument: customers without a NIT say, for pickup, whose cédula
// will pick the order up (D-059, D-067). Only its HMAC is kept.
export function PlaceOrderButton({
  choice,
  needsPickupDocument = false,
}: {
  choice: OrderFulfillment;
  needsPickupDocument?: boolean;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pickupDocument, setPickupDocument] = useState("");
  const askDocument = needsPickupDocument && choice.fulfillment === "pickup";
  const documentOk = !askDocument || normalizeIdDocument(pickupDocument) !== null;

  async function placeOrder(idempotencyKey: string) {
    setError(null);
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      // Only the choice: the fee is computed by the server.
      body: JSON.stringify(askDocument ? { ...choice, pickupDocument } : choice),
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
      {askDocument ? (
        <div className="mb-2 flex flex-col gap-1">
          <label htmlFor={fieldId} className="field-label">
            Cédula de quien recogerá el pedido
          </label>
          <input
            id={fieldId}
            name="pickupDocument"
            inputMode="numeric"
            autoComplete="off"
            maxLength={20}
            className="field"
            value={pickupDocument}
            onChange={(event) => setPickupDocument(event.target.value)}
            aria-describedby={`${fieldId}-hint`}
          />
          <p id={`${fieldId}-hint`} className="text-xs text-muted">
            Al recoger, el personal verá la cédula física y tú confirmarás la recogida con este número en la
            página del pedido. Solo guardamos una huella del número y sus 3 últimos dígitos.
          </p>
        </div>
      ) : null}
      <ActionButton onAccept={placeOrder} disabled={!documentOk} className="w-full">
        Confirmar pedido
      </ActionButton>
      {error ? (
        <p role="alert" className="notice notice-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
