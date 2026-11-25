import { formatCalendarDay } from "@/shared/dates";
import type { ReactNode } from "react";

import { formatCop } from "@/modules/pricing";

import { FULFILLMENT_LABELS, formatBogotaDateTime, ORDER_STATUS_LABELS } from "../domain/order-labels";
import { canConfirmPickup } from "../domain/pickup";
import type { OrderDetail } from "../server/orders";
import { CancelOrderForm } from "./cancel-order-form";
import { ConfirmPickupForm } from "./confirm-pickup-form";
import { ReturnChoiceForm } from "./return-choice-form";
import { SetPickupDocumentForm } from "./set-pickup-document-form";
import { PayButton } from "./pay-button";

// Order summary (D-046). No animation (agents.md §8).
// paymentBlockedNotice: shown instead of "Pagar" while sales are blocked
// (D-051). The database refuses the payment anyway.
// pickupWithNit: the customer confirms the pickup with their NIT (D-067).
export function OrderSummary({
  order,
  paymentBlockedNotice = null,
  pickupWithNit = false,
}: {
  order: OrderDetail;
  paymentBlockedNotice?: ReactNode;
  pickupWithNit?: boolean;
}) {
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

      <DeliveryReturnNotice order={order} withNit={pickupWithNit} />

      {order.status === "paid" && !order.needsRefund && order.fulfillment === "delivery" ? (
        <p role="status" className="notice notice-success">
          Pago recibido. Te avisaremos cuando tu pedido salga a domicilio. Al recibirlo, muestra tu cédula y firma.
        </p>
      ) : null}
      {canConfirmPickup(order) ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="notice notice-success">
            {order.status === "paid" ? "Pago recibido. " : ""}
            {pickupWithNit
              ? "Recoge en la tienda presentando una cédula y el NIT de tu empresa."
              : order.pickupDocumentLast3
                ? `Recoge en la tienda quien presente la cédula terminada en ${order.pickupDocumentLast3}.`
                : "Recoge en la tienda con tu cédula."}{" "}
            Al recibirlo, confírmalo aquí con el mismo número.
          </p>
          {order.pickupLocked ? (
            <p role="status" className="notice notice-warning">
              Se superó el número de intentos para confirmar la recogida. Pide ayuda en la tienda.
            </p>
          ) : order.pickupNeedsDocument ? (
            <SetPickupDocumentForm orderId={order.id} />
          ) : (
            <ConfirmPickupForm orderId={order.id} withNit={pickupWithNit} />
          )}
        </div>
      ) : null}
      {order.status === "out_for_delivery" ? (
        <p role="status" className="notice notice-info">
          Tu pedido va en camino. Ten a mano tu cédula: quien reciba debe mostrarla y firmar.
        </p>
      ) : null}
      {order.needsRefund ? (
        <p role="status" className="notice notice-warning">
          {order.refundAmountCop != null && order.refundAmountCop < order.totalCop
            ? `Te devolveremos ${formatCop(order.refundAmountCop)}, el valor de los productos. El domicilio no se devuelve porque sí se intentó. Nos pondremos en contacto contigo.`
            : "Recibimos tu pago, pero no podemos completar el pedido. Te devolveremos el dinero; nos pondremos en contacto contigo."}
        </p>
      ) : null}
    </div>
  );
}


// A failed delivery back at the store (D-059, D-068). No animation (agents.md §8).
function DeliveryReturnNotice({ order, withNit }: { order: OrderDetail; withNit: boolean }) {
  if (!order.returnKind || order.status !== "preparing") return null;

  if (order.returnKind === "customer" && order.returnChoice === null) {
    const expired = order.returnChoiceDeadline !== null && new Date(order.returnChoiceDeadline) <= new Date();
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="notice notice-warning">
          No pudimos entregar tu pedido y volvió a la tienda.{" "}
          {expired
            ? "Pasaron los 3 días para elegir: el pedido queda para recoger en la tienda."
            : order.returnChoiceDeadline
              ? `Elige qué prefieres antes del ${formatBogotaDateTime(order.returnChoiceDeadline)} (hora de Colombia). Si no eliges, queda para recoger en la tienda.`
              : "Elige qué prefieres."}
        </p>
        {expired ? null : <ReturnChoiceForm orderId={order.id} withNit={withNit} />}
      </div>
    );
  }
  if (order.fulfillment === "delivery" && order.scheduledDeliveryOn) {
    return (
      <p role="status" className="notice notice-info">
        {order.returnKind === "force_majeure"
          ? "No pudimos entregar tu pedido por un imprevisto ajeno a ti. "
          : "Programamos de nuevo tu domicilio. "}
        Lo enviaremos el {formatCalendarDay(order.scheduledDeliveryOn)}, sin costo adicional.
      </p>
    );
  }
  if (order.returnChoiceDefaulted && order.fulfillment === "pickup") {
    return (
      <p role="status" className="notice notice-info">
        No elegiste una opción en los 3 días, así que tu pedido quedó para recoger en la tienda.
      </p>
    );
  }
  return null;
}
