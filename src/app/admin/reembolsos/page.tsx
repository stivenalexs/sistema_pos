import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole } from "@/modules/customers";
import { listRefunds, markRefundedAction } from "@/modules/orders";
import { formatCop } from "@/modules/pricing";
import { PageHeader } from "@/shared/ui/page-header";
import { ReasonActionForm } from "@/shared/ui/reason-action-form";

export const metadata: Metadata = { title: "Reembolsos · Administración" };

const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
const REASONS: Record<string, string> = {
  insufficient_stock_after_payment: "Pagó, pero ya no había stock",
  payment_for_closed_order: "Pagó después de que el pedido se canceló",
};

// Money to return (D-040, D-055). The refund is made in the Wompi dashboard;
// here it is only recorded, with its reference.
export default function RefundsPage() {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader size="compact" title="Reembolsos">
        Pedidos con un pago que no se puede cumplir. Devuelve el dinero desde el panel de Wompi (con el id de la
        transacción) y registra aquí la referencia del reembolso.
      </PageHeader>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Refunds />
      </Suspense>
    </section>
  );
}

async function Refunds() {
  await connection();
  if ((await getStaffRole()) !== "admin") redirect("/login?next=/admin/reembolsos");
  const refunds = await listRefunds();
  if (refunds.length === 0) return <p className="notice notice-success">No hay reembolsos pendientes.</p>;

  return (
    <ul className="flex flex-col gap-3">
      {refunds.map((r) => (
        <li key={r.orderId} className="card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              {r.customer} <span className="text-sm text-muted">{r.email}</span>
            </p>
            <p className="text-lg text-gold tabular-nums">{formatCop(r.totalCop)}</p>
          </div>
          <p className="text-sm">
            {REASONS[r.refundReason] ?? r.refundReason}
            {r.paidAt ? ` · pagó el ${DATE.format(new Date(r.paidAt))}` : ""}
          </p>
          <p className="text-xs text-muted">
            Pedido {r.orderId.slice(0, 8).toUpperCase()} · transacción Wompi {r.transactionId ?? "—"}
          </p>
          <ReasonActionForm
            action={markRefundedAction}
            hidden={{ orderId: r.orderId }}
            fields={[
              { name: "reference", label: "Referencia del reembolso en Wompi", maxLength: 120 },
              { name: "note", label: "Nota", placeholder: "Devuelto a la tarjeta del cliente" },
            ]}
            submitLabel="Registrar reembolso"
          />
        </li>
      ))}
    </ul>
  );
}
