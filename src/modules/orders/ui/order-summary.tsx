import type { ReactNode } from "react";

import { formatCop } from "@/modules/pricing";

import { FULFILLMENT_LABELS, formatBogotaDateTime, ORDER_STATUS_LABELS } from "../domain/order-labels";
import type { OrderDetail } from "../server/orders";
import { CancelOrderForm } from "./cancel-order-form";
import { PayButton } from "./pay-button";

// Order summary (D-046). No animation (agents.md §8).
// paymentBlockedNotice: shown instead of "Pagar" while sales are blocked
// (D-051). The database refuses the payment anyway.
export function OrderSummary({ order, paymentBlockedNotice = null }: { order: OrderDetail; paymentBlockedNotice?: ReactNode }) {
  const unit = (quantity: number) =>
    order.saleUnit === "box"
      ? quantity === 1 ? "caja" : "cajas"
      : quantity === 1 ? "unidad" : "unidades";

  return (
    <div className="flex flex-col gap-6">
      <dl className="card grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-5 text-sm">
        <dt className="text-muted">Estado</dt>
        <dd className="font-medium text-gold">{ORDER_STATUS_LABELS[order.status] ?? order.status}</dd>
        <dt className="text-muted">Entrega</dt>
        <dd>{FULFILLMENT_LABELS[order.fulfillment] ?? order.fulfillment}</dd>
        {order.delivery ? (
          <>
            <dt className="text-muted">Dirección</dt>
            <dd>
              {order.delivery.addressLine}, {order.delivery.municipality}
              {order.delivery.details ? <span className="block text-muted">{order.delivery.details}</span> : null}
            </dd>
          </>
        ) : null}
        <dt className="text-muted">Creado</dt>
        <dd>{formatBogotaDateTime(order.createdAt)}</dd>
        {order.deliveredAt ? (
          <>
            <dt className="text-muted">Entregado</dt>
            <dd>{formatBogotaDateTime(order.deliveredAt)}</dd>
          </>
        ) : null}
      </dl>

      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {order.items.map((item) => (
          <li key={item.sku} className="flex justify-between gap-4 py-4">
            <span>
              {item.productName}
              <span className="block text-sm text-muted">
                {item.quantity} {unit(item.quantity)} × {formatCop(item.unitPriceCop)}
              </span>
            </span>
            <span className="whitespace-nowrap tabular-nums">{formatCop(item.lineTotalCop)}</span>
          </li>
        ))}
      </ul>

      {order.fulfillment === "delivery" ? (
        <div className="flex flex-col gap-1 text-sm tabular-nums">
          <p className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatCop(order.subtotalCop)}</span>
          </p>
          <p className="flex justify-between">
            <span>Domicilio</span>
            <span>{order.deliveryFeeCop === 0 ? "Gratis" : formatCop(order.deliveryFeeCop)}</span>
          </p>
        </div>
      ) : null}

      <p className="flex justify-between border-t border-line pt-3 text-lg font-semibold tabular-nums">
        <span>Total</span>
        <span className="text-gold">{formatCop(order.totalCop)}</span>
      </p>

      {order.status === "awaiting_payment" ? (
        <div className="flex flex-col gap-3">
          {order.paymentDeadline ? (
            <p className="text-sm text-muted">
              Te guardamos los productos hasta las {formatBogotaDateTime(order.paymentDeadline)}.
            </p>
          ) : null}
          {paymentBlockedNotice ?? <PayButton orderId={order.id} />}
          <CancelOrderForm orderId={order.id} />
        </div>
      ) : null}

      {order.status === "paid" && !order.needsRefund ? (
        <p role="status" className="notice notice-success">
          {order.fulfillment === "delivery"
            ? "Pago recibido. Te avisaremos cuando tu pedido salga a domicilio. Al recibirlo, muestra tu cédula y firma."
            : "Pago recibido. Te avisaremos cuando tu pedido esté listo para recoger."}
        </p>
      ) : null}
      {order.status === "out_for_delivery" ? (
        <p role="status" className="notice notice-info">
          Tu pedido va en camino. Ten a mano tu cédula: quien reciba debe mostrarla y firmar.
        </p>
      ) : null}
      {order.needsRefund ? (
        <p role="status" className="notice notice-warning">
          Recibimos tu pago, pero no podemos completar el pedido. Te devolveremos el dinero; nos
          pondremos en contacto contigo.
        </p>
      ) : null}
    </div>
  );
}
