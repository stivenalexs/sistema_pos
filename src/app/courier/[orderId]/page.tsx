import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { DeliveryAttemptForm, getCourierDelivery, getDeliveryStaff } from "@/modules/delivery";
import { formatCop } from "@/modules/pricing";

export default function CourierDeliveryPage({ params }: PageProps<"/courier/[orderId]">) {
  return (
    <section className="flex flex-col gap-6">
      <p className="text-sm">
        <Link href="/courier" className="underline">
          Volver a mis entregas
        </Link>
      </p>
      <Suspense fallback={<p className="text-neutral-600">Cargando pedido…</p>}>
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
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Entrega</h1>
        <p className="font-medium">
          {address.address_line}, {address.municipality}
        </p>
        {address.details ? <p className="text-neutral-600">{address.details}</p> : null}
        <p>
          {address.contact_name ?? "Cliente"}
          {address.contact_phone ? (
            <>
              {" · "}
              <a href={`tel:${address.contact_phone}`} className="underline">
                {address.contact_phone}
              </a>
            </>
          ) : null}
        </p>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline">
          Ver el punto en el mapa
        </a>
      </div>

      <ul className="flex flex-col divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
        {delivery.items.map((item) => (
          <li key={item.productName} className="py-2">
            {item.quantity} {item.saleUnit === "box" ? `caja(s) de ${item.unitsPerBox}` : "unidad(es)"} · {item.productName}
          </li>
        ))}
      </ul>
      <p className="text-sm">Total pagado: {formatCop(delivery.totalCop)}</p>

      {delivery.status === "out_for_delivery" ? (
        <DeliveryAttemptForm orderId={delivery.orderId} />
      ) : (
        <p role="status">Este pedido ya no está en camino.</p>
      )}
    </div>
  );
}
