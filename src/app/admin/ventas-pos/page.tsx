import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole } from "@/modules/customers";
import { ORDER_STATUS_LABELS } from "@/modules/orders";
import { listPosSalesForAdmin, POS_PAYMENT_LABELS, voidPosSaleAction } from "@/modules/pos";
import { formatCop } from "@/modules/pricing";
import { PageHeader } from "@/shared/ui/page-header";
import { ReasonActionForm } from "@/shared/ui/reason-action-form";

export const metadata: Metadata = { title: "Ventas POS · Administración" };

const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
const INVOICE_LABELS: Record<string, string> = {
  pending: "Factura pendiente",
  sent: "Factura enviada",
  accepted: "Factura aceptada",
  rejected: "Factura rechazada",
};

// POS sales and their void (D-053, D-057). Voiding returns the stock with
// return_in movements, marks the sale refunded and asks for the credit note
// when the invoice was accepted.
export default function PosSalesPage() {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader size="compact" title="Ventas POS">
        Las últimas 50 ventas de la caja. Anular devuelve las botellas al inventario y, si la factura ya fue aceptada,
        pide la nota crédito. Si la factura se está emitiendo, espera a que Factus responda.
      </PageHeader>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Sales />
      </Suspense>
    </section>
  );
}

async function Sales() {
  await connection();
  if ((await getStaffRole()) !== "admin") redirect("/login?next=/admin/ventas-pos");
  const sales = await listPosSalesForAdmin();
  if (sales.length === 0) return <p className="text-sm text-muted">Todavía no hay ventas en la caja.</p>;

  return (
    <ul className="flex flex-col gap-3">
      {sales.map((s) => (
        <li key={s.orderId} className="card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              {DATE.format(new Date(s.createdAt))}
              <span className="text-sm text-muted">
                {" "}
                · {s.units} {s.units === 1 ? "unidad" : "unidades"} ·{" "}
                {s.paymentMethod ? POS_PAYMENT_LABELS[s.paymentMethod] : "—"}
              </span>
            </p>
            <p className={`text-lg tabular-nums ${s.voidedAt ? "text-muted line-through" : "text-gold"}`}>
              {formatCop(s.totalCop)}
            </p>
          </div>
          <p className="text-xs text-muted">
            Venta {s.orderId.slice(0, 8).toUpperCase()} · cajero {s.cashier ?? "—"} · {s.customer ?? "Consumidor final"}
            {" · "}
            {s.invoiceStatus ? INVOICE_LABELS[s.invoiceStatus] : "Sin factura todavía"}
            {s.invoiceNumber ? ` ${s.invoiceNumber}` : ""}
          </p>
          {s.voidedAt ? (
            <p className="notice notice-info text-sm">
              {ORDER_STATUS_LABELS[s.status] ?? s.status}: anulada el {DATE.format(new Date(s.voidedAt))}
              {s.voidedBy ? ` por ${s.voidedBy}` : ""}. Motivo: {s.voidReason}
            </p>
          ) : (
            <ReasonActionForm
              action={voidPosSaleAction}
              hidden={{ orderId: s.orderId }}
              fields={[{ name: "reason", label: "Motivo de la anulación", placeholder: "El cliente devolvió la botella" }]}
              submitLabel="Anular venta"
              pendingLabel="Anulando…"
            />
          )}
        </li>
      ))}
    </ul>
  );
}
