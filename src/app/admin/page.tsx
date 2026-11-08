import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getAdminSummary, getStaffRole } from "@/modules/customers";
import { PageHeader } from "@/shared/ui/page-header";

export default function AdminHome() {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader eyebrow="Panel" title="Resumen" />
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Summary />
      </Suspense>
    </section>
  );
}

async function Summary() {
  await connection();
  if ((await getStaffRole()) !== "admin") redirect("/login?next=/admin");
  const summary = await getAdminSummary();
  const cards = [
    { href: "/admin/mayoristas", label: "Mayoristas por revisar", value: summary.pendingWholesale },
    { href: "/admin/personal", label: "Personal activo", value: summary.staff },
    { href: "/admin/personal", label: "Invitaciones pendientes", value: summary.pendingInvitations },
    { href: "/admin/facturas", label: "Facturas o notas rechazadas", value: summary.invoicesAttention },
    { href: "/admin/reembolsos", label: "Reembolsos por registrar", value: summary.refundsPending },
    { href: "/admin/cola", label: "Trabajos fallidos", value: summary.failedActions },
  ];
  return (
    <div className="flex flex-col gap-4">
    {summary.queueStuck > 0 ? (
      <p role="status" className="notice notice-warning">
        Hay {summary.queueStuck} trabajos detenidos hace más de 10 minutos: revisa la <Link href="/admin/cola" className="link">cola</Link>.
      </p>
    ) : null}
    <ul className="grid gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <li key={card.label}>
          <Link href={card.href} className="card flex flex-col gap-1 p-5 hover:border-gold">
            <span className="font-display text-4xl text-gold tabular-nums">{card.value}</span>
            <span className="text-sm text-muted">{card.label}</span>
          </Link>
        </li>
      ))}
    </ul>
    </div>
  );
}
