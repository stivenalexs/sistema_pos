import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole } from "@/modules/customers";
import { listInvoicesForAdmin, retryCreditNoteAction, retryInvoiceAction } from "@/modules/invoicing";
import { formatCop } from "@/modules/pricing";
import { PageHeader } from "@/shared/ui/page-header";
import { ReasonActionForm } from "@/shared/ui/reason-action-form";

export const metadata: Metadata = { title: "Facturas · Administración" };

const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
const STATUS: Record<string, string> = { pending: "En cola", sent: "Enviada", accepted: "Aceptada", rejected: "Rechazada" };
const REASON_FIELD = [{ name: "reason", label: "Motivo del reintento", placeholder: "Rango de numeración renovado" }];

// Invoices and credit notes that need attention (D-055). A retry sends the
// same reference to Factus again once the cause is fixed.
export default function InvoicesPage() {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader size="compact" title="Facturas">
        Facturas y notas crédito que todavía no acepta la DIAN. Corrige la causa (por ejemplo, el rango de numeración en
        Factus) antes de reintentar: se envía de nuevo con la misma referencia.
      </PageHeader>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Invoices />
      </Suspense>
    </section>
  );
}

async function Invoices() {
  await connection();
  if ((await getStaffRole()) !== "admin") redirect("/login?next=/admin/facturas");
  const { invoices, creditNotes } = await listInvoicesForAdmin();

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-3xl">Facturas sin aceptar</h2>
        {invoices.length === 0 ? (
          <p className="notice notice-success">Todas las facturas están aceptadas.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {invoices.map((i) => (
              <li key={i.id} className="card flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {i.referenceCode} <span className="badge ml-2">{STATUS[i.status] ?? i.status}</span>
                    <span className="ml-2 text-sm text-muted">{i.channel === "pos" ? "Caja" : "Web"}</span>
                  </p>
                  <p className="tabular-nums">{formatCop(i.totalCop)}</p>
                </div>
                <p className="text-xs text-muted">
                  Intentos: {i.attempts} · actualizada {DATE.format(new Date(i.updatedAt))} · emisión:{" "}
                  {i.actionStatus === "failed" ? "detenida" : i.actionStatus === "succeeded" ? "terminada" : "en cola"}
                </p>
                {i.responseMessage || i.lastError ? (
                  <p className="notice notice-danger text-sm">{i.responseMessage ?? i.lastError}</p>
                ) : null}
                {i.actionStatus === "failed" ? (
                  <ReasonActionForm action={retryInvoiceAction} hidden={{ invoiceId: i.id }} fields={REASON_FIELD} submitLabel="Reintentar" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-3xl">Notas crédito</h2>
        {creditNotes.length === 0 ? (
          <p className="text-sm text-muted">No hay notas crédito.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {creditNotes.map((n) => (
              <li key={n.id} className="card flex flex-col gap-2 p-4">
                <p className="font-medium">
                  {n.referenceCode} <span className="badge ml-2">{STATUS[n.status] ?? n.status}</span>
                  <span className="ml-2 text-sm text-muted">
                    factura {n.invoiceNumber ?? "—"} ·{" "}
                    {n.kind === "products_only" ? "parcial: solo productos (concepto 1)" : "anulación total (concepto 2)"}
                  </span>
                </p>
                <p className="text-sm text-muted">
                  {n.reason} · {DATE.format(new Date(n.createdAt))}
                </p>
                {n.lastError ? <p className="notice notice-danger text-sm">{n.lastError}</p> : null}
                {n.status !== "accepted" && n.actionStatus === "failed" ? (
                  <ReasonActionForm action={retryCreditNoteAction} hidden={{ creditNoteId: n.id }} fields={REASON_FIELD} submitLabel="Reintentar" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
