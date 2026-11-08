import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getAdminSummary, getStaffRole } from "@/modules/customers";
import { PageHeader } from "@/shared/ui/page-header";

import { adminTasks } from "./admin-tasks";

export const metadata: Metadata = { title: "Administración" };

export default function AdminHome() {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader title="Resumen" size="compact" />
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Summary />
      </Suspense>
    </section>
  );
}

// Tray of what needs attention today (D-064): pending items first, ordered by
// urgency, in gold; everything up to date goes in one quiet line.
async function Summary() {
  await connection();
  const role = await getStaffRole();
  // Warehouse staff only have the inventory section (D-056).
  if (role === "warehouse") redirect("/admin/inventario");
  if (role !== "admin") redirect("/login?next=/admin");

  const summary = await getAdminSummary();
  const { pending, upToDate } = adminTasks(summary);

  return (
    <div className="flex flex-col gap-6">
      {pending.length === 0 ? (
        <div className="card flex flex-col gap-2 p-6">
          <p className="font-display text-3xl">Todo al día.</p>
          <p className="text-sm text-muted">No hay pedidos, facturas ni clientes esperando una decisión.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted">
            {pending.length === 1 ? "1 tarea pendiente" : `${pending.length} tareas pendientes`}
          </h2>
          <ul className="card divide-y divide-line">
            {pending.map((task) => (
              <li key={task.key}>
                <Link
                  href={task.href}
                  className="flex items-baseline gap-4 px-5 py-4 hover:bg-field"
                >
                  <span
                    className={`w-14 shrink-0 text-right font-display text-3xl leading-none tabular-nums ${
                      task.urgent ? "text-gold" : "text-ink"
                    }`}
                  >
                    {task.count}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px]">{task.label}</span>
                  <span className="shrink-0 text-sm text-gold">{task.action}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pending.length > 0 && upToDate.length > 0 ? (
        <p className="text-sm text-muted">Al día: {upToDate.join(", ")}.</p>
      ) : null}
      <p className="text-sm text-muted">
        Personal activo: {summary.staff}.{" "}
        <Link href="/admin/personal" className="link">
          Ver el equipo
        </Link>
      </p>
    </div>
  );
}
