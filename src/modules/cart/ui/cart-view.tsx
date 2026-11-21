import type { ReactNode } from "react";

import { type FulfillmentChoice, FulfillmentPicker } from "@/modules/delivery";
import { formatCop, QUOTE_ERROR_MESSAGES } from "@/modules/pricing";

import type { CartView as CartViewData } from "../server/get-cart";
import { AddToCartForm } from "./add-to-cart-form";
import { PlaceOrderButton } from "./place-order-button";

// Cart screen (D-046). No animation (agents.md §8). All prices come from the server.
// salesBlockNotice: while sales are blocked (D-051) the cart stays, with the
// notice instead of "Confirmar pedido". The database refuses the order anyway.
export function CartView({
  cart,
  choice,
  salesBlockNotice = null,
  needsPickupDocument = false,
}: {
  cart: CartViewData;
  choice: FulfillmentChoice;
  salesBlockNotice?: ReactNode;
  /** Customers without a NIT give the cédula of who picks up (D-067). */
  needsPickupDocument?: boolean;
}) {
  if (cart.lines.length === 0) {
    return <p className="notice notice-info">Tu carrito está vacío.</p>;
  }
  const canPlace =
    choice.fulfillment === "pickup" || (choice.selectedAddressId !== null && choice.quote?.ok === true);

  const unitLabel = cart.saleUnit === "box" ? "cajas" : "unidades";

  return (
    <div className="flex flex-col gap-8">
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {cart.lines.map((line) => {
          const error = line.quote?.error ?? null;
          const outOfStock =
            line.availableSaleUnits !== null && line.quantity > line.availableSaleUnits;
          return (
            <li key={line.productId} className="flex flex-col gap-3 py-5">
              <div className="flex items-start justify-between gap-4">
                <h2 className="font-display text-2xl leading-tight">{line.name}</h2>
                <p className="whitespace-nowrap font-semibold text-gold tabular-nums">
                  {line.quote?.lineTotalCop != null ? formatCop(line.quote.lineTotalCop) : "—"}
                </p>
              </div>
              {line.quote?.unitPriceCop != null ? (
                <p className="text-sm text-muted">
                  {line.quantity} × {formatCop(line.quote.unitPriceCop)}
                </p>
              ) : null}
              {error ? (
                <p className="text-sm text-danger">
                  {QUOTE_ERROR_MESSAGES[error]}
                  {error === "below_minimum" && line.quote?.minQuantity
                    ? ` Mínimo: ${line.quote.minQuantity} ${unitLabel}.`
                    : ""}
                </p>
              ) : null}
              {!error && outOfStock ? (
                <p className="text-sm text-danger">
                  Solo quedan {line.availableSaleUnits} {unitLabel} disponibles.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-4">
                <AddToCartForm
                  productId={line.productId}
                  minQuantity={line.quote?.minQuantity ?? 1}
                  unitLabel={unitLabel}
                  submitLabel="Actualizar"
                  defaultQuantity={line.quantity}
                />
              </div>
              <p className="text-xs text-muted">Para quitar el producto, pon la cantidad en 0.</p>
            </li>
          );
        })}
      </ul>

      {cart.quote?.ok ? <FulfillmentPicker choice={choice} /> : null}

      {cart.quote?.ok && cart.quote.totalCop != null ? (
        <Totals subtotalCop={cart.quote.totalCop} choice={choice} />
      ) : (
        <p className="notice notice-danger">Corrige las líneas marcadas para poder confirmar el pedido.</p>
      )}

      {salesBlockNotice}

      {cart.quote?.ok && canPlace && !salesBlockNotice ? (
        <PlaceOrderButton
          // A different choice is a different intent: remount for a new key.
          key={`${choice.fulfillment}:${choice.selectedAddressId ?? ""}`}
          needsPickupDocument={needsPickupDocument}
          choice={
            choice.fulfillment === "delivery" && choice.selectedAddressId
              ? { fulfillment: "delivery", addressId: choice.selectedAddressId }
              : { fulfillment: "pickup" }
          }
        />
      ) : null}
    </div>
  );
}

// Display only: the order total is computed again by the database.
function Totals({ subtotalCop, choice }: { subtotalCop: number; choice: FulfillmentChoice }) {
  const fee = choice.fulfillment === "delivery" && choice.quote?.ok ? choice.quote.feeCop : 0;
  return (
    <div className="card flex flex-col gap-2 p-5 tabular-nums">
      <p className="flex justify-between">
        <span>Subtotal</span>
        <span>{formatCop(subtotalCop)}</span>
      </p>
      <p className="flex justify-between gap-4 text-sm text-muted">
        <span>Entrega</span>
        <span className="text-right">
          {choice.fulfillment === "pickup"
            ? "Recoger en la tienda (sin costo)"
            : choice.quote?.ok
              ? fee === 0
                ? "Domicilio gratis"
                : `Domicilio ${formatCop(fee)}`
              : "—"}
        </span>
      </p>
      <p className="mt-2 flex justify-between border-t border-line pt-3 text-lg font-semibold">
        <span>Total</span>
        <span className="text-gold">{formatCop(subtotalCop + fee)}</span>
      </p>
    </div>
  );
}
