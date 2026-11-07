import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { CartView, getCartView } from "@/modules/cart";
import { getCurrentCustomer } from "@/modules/customers";
import { type FulfillmentChoice, getDeliveryAddresses, quoteDelivery } from "@/modules/delivery";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function CartPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mi carrito</h1>
      <Suspense fallback={<p className="text-neutral-600">Cargando carrito…</p>}>
        <Cart searchParams={searchParams} />
      </Suspense>
      <p className="text-sm">
        <Link href="/" className="underline">
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

  return <CartView cart={cart} choice={choice} />;
}
