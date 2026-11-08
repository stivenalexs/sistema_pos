import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole } from "@/modules/customers";
import { getQueueStatus, retryActionAction } from "@/shared/actions/server/admin-queue";
import { PageHeader } from "@/shared/ui/page-header";
import { ReasonActionForm } from "@/shared/ui/reason-action-form";

export const metadata: Metadata = { title: "Cola de trabajos · Administración" };

const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });

const TYPE_LABELS: Record<string, string> = {
  issue_invoice: "Emitir factura",
  issue_credit_note: "Emitir nota crédito",
  process_payment_event: "Aplicar evento de pago",
  confirm_delivery: "Confirmar entrega",
  noop: "Prueba",
};

// Background work (D-034, D-055): failed actions and the queue health.
export default function QueuePage() {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader eyebrow="Panel" title="Cola de trabajos">
        Facturas, notas crédito, pagos y entregas se procesan en segundo plano. Reintentar es seguro: cada trabajo se
        puede repetir sin duplicar efectos.
      </PageHeader>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Queue />
      </Suspense>
    </section>
  );
}

async function Queue() {
  await connection();
  if ((await getStaffRole()) !== "admin") redirect("/login?next=/admin/cola");
  const status = await getQueueStatus();
  const stuck = status.overdue + status.stalled;

  return (
    <div className="flex flex-col gap-8">
      {stuck > 0 ? (
        <p role="status" className="notice notice-warning">
          La cola parece detenida: {status.overdue} {status.overdue === 1 ? "trabajo listo" : "trabajos listos"} hace más
          de 10 minutos y {status.stalled} en proceso hace más de 10 minutos. Revisa que el worker esté corriendo (el
          job de pg_cron y la URL y el secreto en Supabase Vault).
        </p>
      ) : (
        <p className="notice notice-success">
          La cola está al día. En espera: {status.queued}.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-3xl">Trabajos fallidos ({status.failedCount})</h2>
        {status.failed.length === 0 ? (
          <p className="text-sm text-muted">No hay trabajos fallidos.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {status.failed.map((a) => (
              <li key={a.id} className="card flex flex-col gap-2 p-4">
                <p className="font-medium">
                  {TYPE_LABELS[a.type] ?? a.type}
                  <span className="ml-2 text-xs text-muted">
                    {a.attempts}/{a.maxAttempts} intentos · {a.finishedAt ? DATE.format(new Date(a.finishedAt)) : ""}
                  </span>
                </p>
                {a.error ? <p className="notice notice-danger text-sm break-all">{a.error}</p> : null}
                <ReasonActionForm
                  action={retryActionAction}
                  hidden={{ actionId: a.id }}
                  fields={[{ name: "reason", label: "Motivo del reintento", placeholder: "Se corrigió la configuración" }]}
                  submitLabel="Reintentar"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
