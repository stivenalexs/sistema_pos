import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { DeliveryAttemptForm, getCourierDelivery, getDeliveryStaff } from "@/modules/delivery";
import { formatCop } from "@/modules/pricing";

export default function CourierDeliveryPage({ params }: PageProps<"/courier/[orderId]">) {
  return (
    <section className="page-narrow flex flex-col gap-8">
      <p className="text-sm">
        <Link href="/courier" className="link">
          Volver a mis entregas
        </Link>
      </p>
      <Suspense fallback={<p className="text-muted">Cargando pedido…</p>}>
        <Delivery params={params} />
      </Suspense>
    </section>
  );
}

async function Delivery({ params }: { params: PageProps<"/courier/[orderId]">["params"] }) {
  await connection();
  const staff = await getDeliveryStaff();
  if (!staff) redirect("/login?next=/courier");

  const { orderId } = await params;
  // RLS: a courier only gets the orders assigned to them.
  const delivery = await getCourierDelivery(orderId);
  if (!delivery) notFound();

  const { address } = delivery;
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${address.lat}&mlon=${address.lng}#map=18/${address.lat}/${address.lng}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="eyebrow">Mensajero</p>
        <h1 className="display-title mb-2 text-[44px]">Entrega</h1>
        <p className="text-lg font-medium">
          {address.address_line}, {address.municipality}
        </p>
        {address.details ? <p className="text-muted">{address.details}</p> : null}
        <p>
          {address.contact_name ?? "Cliente"}
          {address.contact_phone ? (
            <>
              {" · "}
              <a href={`tel:${address.contact_phone}`} className="link">
                {address.contact_phone}
              </a>
            </>
          ) : null}
        </p>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="link text-sm">
          Ver el punto en el mapa
        </a>
      </div>

      <ul className="flex flex-col divide-y divide-line border-y border-line text-sm">
        {delivery.items.map((item) => (
          <li key={item.productName} className="py-3">
            {item.quantity} {item.saleUnit === "box" ? `caja(s) de ${item.unitsPerBox}` : "unidad(es)"} · {item.productName}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">Total pagado: {formatCop(delivery.totalCop)}</p>

      {delivery.status === "out_for_delivery" ? (
        <DeliveryAttemptForm orderId={delivery.orderId} />
      ) : (
        <p role="status" className="notice notice-info">Este pedido ya no está en camino.</p>
      )}
    </div>
  );
}
