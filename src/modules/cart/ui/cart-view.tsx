import { formatCop, QUOTE_ERROR_MESSAGES } from "@/modules/pricing";

import type { CartView as CartViewData } from "../server/get-cart";
import { AddToCartForm } from "./add-to-cart-form";
import { PlaceOrderButton } from "./place-order-button";

// Cart screen (functional, no design yet; D-037). All prices come from the server.
export function CartView({ cart }: { cart: CartViewData }) {
  if (cart.lines.length === 0) {
    return <p>Tu carrito está vacío.</p>;
  }

  const unitLabel = cart.saleUnit === "box" ? "cajas" : "unidades";

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col divide-y divide-neutral-200 border-y border-neutral-200">
        {cart.lines.map((line) => {
          const error = line.quote?.error ?? null;
          const outOfStock =
            line.availableSaleUnits !== null && line.quantity > line.availableSaleUnits;
          return (
            <li key={line.productId} className="flex flex-col gap-2 py-4">
              <div className="flex items-start justify-between gap-4">
                <h2 className="font-medium">{line.name}</h2>
                <p className="whitespace-nowrap font-semibold">
                  {line.quote?.lineTotalCop != null ? formatCop(line.quote.lineTotalCop) : "—"}
                </p>
              </div>
              {line.quote?.unitPriceCop != null ? (
                <p className="text-sm text-neutral-600">
                  {line.quantity} × {formatCop(line.quote.unitPriceCop)}
                </p>
              ) : null}
              {error ? (
                <p className="text-sm text-red-700">
                  {QUOTE_ERROR_MESSAGES[error]}
                  {error === "below_minimum" && line.quote?.minQuantity
                    ? ` Mínimo: ${line.quote.minQuantity} ${unitLabel}.`
                    : ""}
                </p>
              ) : null}
              {!error && outOfStock ? (
                <p className="text-sm text-red-700">
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
              <p className="text-xs text-neutral-500">Para quitar el producto, pon la cantidad en 0.</p>
            </li>
          );
        })}
      </ul>

      {cart.quote?.ok && cart.quote.totalCop != null ? (
        <div className="flex flex-col gap-1">
          <p className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatCop(cart.quote.totalCop)}</span>
          </p>
          <p className="flex justify-between text-sm text-neutral-600">
            <span>Entrega</span>
            <span>Recoger en la tienda (sin costo)</span>
          </p>
          <p className="flex justify-between text-lg font-semibold">
            <span>Total</span>
            <span>{formatCop(cart.quote.totalCop)}</span>
          </p>
        </div>
      ) : (
        <p className="text-red-700">Corrige las líneas marcadas para poder confirmar el pedido.</p>
      )}

      {cart.quote?.ok ? <PlaceOrderButton /> : null}
    </div>
  );
}
