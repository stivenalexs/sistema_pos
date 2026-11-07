import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { formatDistance, getDeliveryStaff, listCourierDeliveries } from "@/modules/delivery";

// Courier screen (mobile first, no animation; D-045). Shows only the orders
// assigned to the courier (RLS); an administrator sees every order on its way.
export default function CourierPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mis entregas</h1>
      <Suspense fallback={<p className="text-neutral-600">Cargando entregas…</p>}>
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
  if (deliveries.length === 0) return <p>No tienes pedidos en camino.</p>;

  return (
    <ul className="flex flex-col gap-3">
      {deliveries.map((delivery) => (
        <li key={delivery.orderId}>
          <Link href={`/courier/${delivery.orderId}`} className="block rounded-md border border-neutral-300 p-4">
            <span className="block font-medium">
              {delivery.address.address_line}, {delivery.address.municipality}
            </span>
            {delivery.address.details ? (
              <span className="block text-sm text-neutral-600">{delivery.address.details}</span>
            ) : null}
            <span className="block text-sm text-neutral-600">
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
