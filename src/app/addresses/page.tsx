import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getCurrentCustomer } from "@/modules/customers";
import {
  AddressForm,
  DeleteAddressForm,
  formatDistance,
  getDeliveryAddresses,
  getDeliveryZones,
  MAP_DEFAULT_CENTER,
} from "@/modules/delivery";

export default function AddressesPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mis direcciones</h1>
      <Suspense fallback={<p className="text-neutral-600">Cargando direcciones…</p>}>
        <Addresses />
      </Suspense>
      <p className="text-sm">
        <Link href="/cart" className="underline">
          Volver al carrito
        </Link>
      </p>
    </section>
  );
}

async function Addresses() {
  await connection();
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?next=/addresses");

  const [addresses, zones] = await Promise.all([getDeliveryAddresses(), getDeliveryZones()]);

  return (
    <div className="flex flex-col gap-8">
      {addresses.length > 0 ? (
        <ul className="flex flex-col divide-y divide-neutral-200 border-y border-neutral-200">
          {addresses.map((address) => (
            <li key={address.id} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="font-medium">{address.label}</p>
                <p className="text-sm">
                  {address.addressLine}, {address.municipality}
                </p>
                {address.details ? <p className="text-sm text-neutral-600">{address.details}</p> : null}
                <p className="text-xs text-neutral-500">
                  {address.zoneActive
                    ? address.distanceM !== null
                      ? `A ${formatDistance(address.distanceM)} de la tienda`
                      : ""
                    : "Por ahora no hacemos domicilios a este municipio."}
                </p>
              </div>
              <DeleteAddressForm addressId={address.id} />
            </li>
          ))}
        </ul>
      ) : (
        <p>Todavía no tienes direcciones guardadas.</p>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Agregar dirección</h2>
        <p className="text-sm text-neutral-600">
          Hacemos domicilios en los municipios del Valle de Aburrá. Marca en el mapa el punto exacto de
          entrega: con él calculamos la distancia y el valor del domicilio.
        </p>
        <AddressForm zones={zones} center={MAP_DEFAULT_CENTER} />
      </div>
    </div>
  );
}
