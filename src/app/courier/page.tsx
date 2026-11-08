import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { formatDistance, getDeliveryStaff, listCourierDeliveries } from "@/modules/delivery";
import { PageHeader } from "@/shared/ui/page-header";

// Courier screen (mobile first, no animation; D-045). Shows only the orders
// assigned to the courier (RLS); an administrator sees every order on its way.
export default function CourierPage() {
  return (
    <section className="page-narrow flex flex-col gap-8">
      <PageHeader eyebrow="Mensajero" title="Mis entregas" />
      <Suspense fallback={<p className="text-muted">Cargando entregas…</p>}>
        <Deliveries />
      </Suspense>
    </section>
  );
}

async function Deliveries() {
  await connection();
  const staff = await getDeliveryStaff();
  if (!staff) redirect("/login?next=/courier");

  const deliveries = await listCourierDeliveries(staff);
  if (deliveries.length === 0) return <p className="notice notice-info">No tienes pedidos en camino.</p>;

  return (
    <ul className="flex flex-col gap-3">
      {deliveries.map((delivery) => (
        <li key={delivery.orderId}>
          <Link href={`/courier/${delivery.orderId}`} className="card block p-5 hover:border-gold">
            <span className="block text-base font-medium">
              {delivery.address.address_line}, {delivery.address.municipality}
            </span>
            {delivery.address.details ? (
              <span className="block text-sm text-muted">{delivery.address.details}</span>
            ) : null}
            <span className="block text-sm text-muted">
              {delivery.address.contact_name ?? "Cliente"}
              {delivery.distanceM !== null ? ` · ${formatDistance(delivery.distanceM)}` : ""}
              {` · ${delivery.items.length} ${delivery.items.length === 1 ? "producto" : "productos"}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
