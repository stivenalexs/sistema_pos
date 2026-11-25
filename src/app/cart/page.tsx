import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { CartView, getCartView } from "@/modules/cart";
import { getSalesBlock, SalesBlockNotice } from "@/modules/compliance";
import { getCurrentCustomer } from "@/modules/customers";
import { type FulfillmentChoice, getDeliveryAddresses, quoteDelivery } from "@/modules/delivery";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Mi carrito" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function CartPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <section className="page-narrow flex flex-col gap-10">
      <PageHeader eyebrow="Tu selección" title="Mi carrito" />
      <Suspense fallback={<p className="text-muted">Cargando carrito…</p>}>
        <Cart searchParams={searchParams} />
      </Suspense>
      <p className="text-sm">
        <Link href="/" className="link">
          Seguir comprando
        </Link>
      </p>
    </section>
  );
}

async function Cart({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  // Buying requires a customer account (D-032).
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?next=/cart");

  const params = await searchParams;
  const [cart, addresses] = await Promise.all([getCartView(), getDeliveryAddresses()]);

  // The choice travels in the URL; the address must be one of the customer's.
  const wanted = typeof params.direccion === "string" ? params.direccion : null;
  const selected = params.entrega === "domicilio" ? (addresses.find((a) => a.id === wanted) ?? null) : null;
  const choice: FulfillmentChoice = {
    fulfillment: selected ? "delivery" : "pickup",
    addresses,
    selectedAddressId: selected?.id ?? null,
    quote: selected && cart.lines.length > 0 ? await quoteDelivery(selected.id) : null,
  };

  // Municipality of the sale (D-051): the address for delivery, the store for pickup.
  const block = cart.lines.length > 0 ? await getSalesBlock({ zoneId: selected?.zoneId ?? null }) : null;
  return (
    <CartView
      cart={cart}
      choice={choice}
      salesBlockNotice={block ? <SalesBlockNotice block={block} /> : null}
      needsPickupDocument={!customer.hasNit}
    />
  );
}
