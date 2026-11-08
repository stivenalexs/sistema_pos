import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { ProductList } from "@/modules/catalog";
import { getCurrentCustomer } from "@/modules/customers";
import { getCatalog } from "@/modules/pricing";
import { PageHeader } from "@/shared/ui/page-header";

export default function Home() {
  return (
    <section className="page flex flex-col gap-10">
      <PageHeader eyebrow="El tiempo se saborea" title="Nuestra cava" />
      <Suspense fallback={<p className="text-muted">Cargando productos…</p>}>
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
        <p className="notice notice-info">
          Ves precios al detal.{" "}
          <Link href="/signup" className="link">
            Crea tu cuenta
          </Link>{" "}
          para comprar.
        </p>
      ) : null}
      {customer?.wholesaleStatus === "pending" ? (
        <p role="status" className="notice notice-warning">
          Tu cuenta de mayorista está en revisión. Mientras tanto ves y compras con precios al
          detal.
        </p>
      ) : null}
      {customer?.wholesaleStatus === "approved" ? (
        <p className="notice notice-info">Precios mayoristas, por caja.</p>
      ) : null}
      <ProductList items={items} canBuy={customer !== null} />
    </>
  );
}
