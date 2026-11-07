import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { ProductList } from "@/modules/catalog";
import { getCurrentCustomer } from "@/modules/customers";
import { getCatalog } from "@/modules/pricing";

export default function Home() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Catálogo</h1>
      <Suspense fallback={<p className="text-neutral-600">Cargando productos…</p>}>
        <Catalog />
      </Suspense>
    </section>
  );
}

// Depends on the session: prices and visible products change per customer.
async function Catalog() {
  // Always per request (the Supabase client reads the clock to check the token).
  await connection();
  const [customer, items] = await Promise.all([getCurrentCustomer(), getCatalog()]);

  return (
    <>
      {customer === null ? (
        <p className="text-sm text-neutral-700">
          Ves precios al detal.{" "}
          <Link href="/signup" className="underline">
            Crea tu cuenta
          </Link>{" "}
          para comprar.
        </p>
      ) : null}
      {customer?.wholesaleStatus === "pending" ? (
        <p role="status" className="rounded-md border border-amber-600 bg-amber-50 p-3 text-sm">
          Tu cuenta de mayorista está en revisión. Mientras tanto ves y compras con precios al
          detal.
        </p>
      ) : null}
      {customer?.wholesaleStatus === "approved" ? (
        <p className="text-sm text-neutral-700">Precios mayoristas, por caja.</p>
      ) : null}
      {customer ? (
        <p className="text-sm">
          <Link href="/cart" className="underline">
            Ver mi carrito
          </Link>
        </p>
      ) : null}
      <ProductList items={items} canBuy={customer !== null} />
    </>
  );
}
