import type { Metadata } from "next";
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
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Mis direcciones" };

export default function AddressesPage() {
  return (
    <section className="page-narrow flex flex-col gap-10">
      <PageHeader eyebrow="Domicilios" title="Mis direcciones" />
      <Suspense fallback={<p className="text-muted">Cargando direcciones…</p>}>
        <Addresses />
      </Suspense>
      <p className="text-sm">
        <Link href="/cart" className="link">
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
        <ul className="flex flex-col gap-3">
          {addresses.map((address) => (
            <li key={address.id} className="card flex items-start justify-between gap-4 p-4">
              <div>
                <p className="font-medium">{address.label}</p>
                <p className="text-sm">
                  {address.addressLine}, {address.municipality}
                </p>
                {address.details ? <p className="text-sm text-muted">{address.details}</p> : null}
                <p className="text-xs text-muted">
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
        <p className="notice notice-info">Todavía no tienes direcciones guardadas.</p>
      )}

      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="font-display text-3xl">Agregar dirección</h2>
        <p className="text-sm text-muted">
          Hacemos domicilios en los municipios del Valle de Aburrá. Marca en el mapa el punto exacto de
          entrega: con él calculamos la distancia y el valor del domicilio.
        </p>
        <AddressForm zones={zones} center={MAP_DEFAULT_CENTER} />
      </div>
    </div>
  );
}
