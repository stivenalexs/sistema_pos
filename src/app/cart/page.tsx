import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { CartView, getCartView } from "@/modules/cart";
import { getCurrentCustomer } from "@/modules/customers";

export default function CartPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mi carrito</h1>
      <Suspense fallback={<p className="text-neutral-600">Cargando carrito…</p>}>
        <Cart />
      </Suspense>
      <p className="text-sm">
        <Link href="/" className="underline">
          Seguir comprando
        </Link>
      </p>
    </section>
  );
}

async function Cart() {
  await connection();
  // Buying requires a customer account (D-032).
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/login?next=/cart");

  const cart = await getCartView();
  return <CartView cart={cart} />;
}
