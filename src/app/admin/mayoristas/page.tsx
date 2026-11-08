import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole, listWholesale, WholesaleReviewForm } from "@/modules/customers";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Mayoristas · Administración" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS = [
  { status: "pending", label: "Por revisar" },
  { status: "approved", label: "Aprobados" },
  { status: "rejected", label: "Rechazados" },
] as const;

const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });

// Wholesale review (D-054). Approving changes the customer's prices on their
// next session refresh (up to 1 hour, D-031). Documents (RUT, cámara de
// comercio) are still pending (P-013).
export default function WholesalePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader size="compact" title="Mayoristas">
        Verifica la razón social y el NIT antes de aprobar. El motivo queda en el historial.
      </PageHeader>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Applicants searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function Applicants({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  if ((await getStaffRole()) !== "admin") redirect("/login?next=/admin/mayoristas");
  const params = await searchParams;
  const status = TABS.find((tab) => tab.status === params.estado)?.status ?? "pending";
  const applicants = await listWholesale(status);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Estado" className="flex gap-4 text-sm">
        {TABS.map((tab) => (
          <Link
            key={tab.status}
            href={tab.status === "pending" ? "/admin/mayoristas" : `/admin/mayoristas?estado=${tab.status}`}
            aria-current={tab.status === status ? "page" : undefined}
            className={tab.status === status ? "font-medium text-gold" : "link"}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {applicants.length === 0 ? (
        <p className="notice notice-info">No hay mayoristas en este estado.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {applicants.map((a) => (
            <li key={a.customerId} className="card flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1">
                <p className="font-display text-2xl">{a.businessName ?? a.fullName}</p>
                <p className="text-sm">
                  NIT {a.nit ?? "—"} · {a.fullName} · {a.email}
                  {a.phone ? ` · ${a.phone}` : ""}
                </p>
                <p className="text-xs text-muted">Registro: {DATE.format(new Date(a.createdAt))}</p>
                {a.lastReview ? (
                  <p className="text-xs text-muted">
                    Última revisión: {a.lastReview.decision === "approved" ? "aprobado" : "rechazado"} ({a.lastReview.reason})
                  </p>
                ) : null}
              </div>
              <WholesaleReviewForm customerId={a.customerId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
