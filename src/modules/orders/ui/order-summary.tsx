import { formatCop } from "@/modules/pricing";

import { FULFILLMENT_LABELS, formatBogotaDateTime, ORDER_STATUS_LABELS } from "../domain/order-labels";
import type { OrderDetail } from "../server/orders";
import { CancelOrderForm } from "./cancel-order-form";
import { PayButton } from "./pay-button";

// Order summary (functional, no design yet; D-037).
export function OrderSummary({ order }: { order: OrderDetail }) {
  const unit = (quantity: number) =>
    order.saleUnit === "box"
      ? quantity === 1 ? "caja" : "cajas"
      : quantity === 1 ? "unidad" : "unidades";

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-neutral-600">Estado</dt>
        <dd className="font-medium">{ORDER_STATUS_LABELS[order.status] ?? order.status}</dd>
        <dt className="text-neutral-600">Entrega</dt>
        <dd>{FULFILLMENT_LABELS[order.fulfillment] ?? order.fulfillment}</dd>
        <dt className="text-neutral-600">Creado</dt>
        <dd>{formatBogotaDateTime(order.createdAt)}</dd>
      </dl>

      <ul className="flex flex-col divide-y divide-neutral-200 border-y border-neutral-200">
        {order.items.map((item) => (
          <li key={item.sku} className="flex justify-between gap-4 py-3">
            <span>
              {item.productName}
              <span className="block text-sm text-neutral-600">
                {item.quantity} {unit(item.quantity)} × {formatCop(item.unitPriceCop)}
              </span>
            </span>
            <span className="whitespace-nowrap">{formatCop(item.lineTotalCop)}</span>
          </li>
        ))}
      </ul>

      <p className="flex justify-between text-lg font-semibold">
        <span>Total</span>
        <span>{formatCop(order.totalCop)}</span>
      </p>

      {order.status === "awaiting_payment" ? (
        <div className="flex flex-col gap-3">
          {order.paymentDeadline ? (
            <p className="text-sm">
              Te guardamos los productos hasta las {formatBogotaDateTime(order.paymentDeadline)}.
            </p>
          ) : null}
          <PayButton orderId={order.id} />
          <CancelOrderForm orderId={order.id} />
        </div>
      ) : null}

      {order.status === "paid" && !order.needsRefund ? (
        <p role="status" className="rounded-md border border-green-700 bg-green-50 p-3">
          Pago recibido. Te avisaremos cuando tu pedido esté listo para recoger.
        </p>
      ) : null}
      {order.needsRefund ? (
        <p role="status" className="rounded-md border border-amber-600 bg-amber-50 p-3">
          Recibimos tu pago, pero no podemos completar el pedido. Te devolveremos el dinero; nos
          pondremos en contacto contigo.
        </p>
      ) : null}
    </div>
  );
}
