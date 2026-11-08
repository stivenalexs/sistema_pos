import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";

import { ProductList } from "@/modules/catalog";
import { getSalesBlock, SalesBlockNotice } from "@/modules/compliance";
import { getCurrentCustomer } from "@/modules/customers";
import { getCatalog } from "@/modules/pricing";

export const metadata: Metadata = { title: "Nuestra cava" };

// Catalog page from the Figma "Nuestra cava · Catálogo" (D-048).
export default function Home() {
  return (
    <section className="page flex flex-col gap-6 pt-9">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-2">
          <p className="eyebrow">El tiempo se saborea</p>
          <h1 className="display-title text-[56px] leading-[1.05]">Nuestra cava</h1>
        </div>
        <p className="font-display text-[23px] text-muted italic">Cada licor, una historia.</p>
      </header>
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
  // Sales block of the store municipality (D-051): a notice, the cart still works.
  const [customer, items, block] = await Promise.all([getCurrentCustomer(), getCatalog(), getSalesBlock()]);

  let message: ReactNode = null;
  if (customer === null) {
    message = (
      <>
        Ves precios al detal.{" "}
        <Link href="/signup" className="link">
          Crea tu cuenta para comprar.
        </Link>
      </>
    );
  } else if (customer.wholesaleStatus === "pending") {
    message = "Tu cuenta de mayorista está en revisión. Mientras tanto ves y compras con precios al detal.";
  } else if (customer.wholesaleStatus === "approved") {
    message = "Precios mayoristas, por caja.";
  }

  return (
    <>
      {block ? <SalesBlockNotice block={block} /> : null}
      <div
        role={customer?.wholesaleStatus === "pending" ? "status" : undefined}
        className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-[4px] border bg-surface px-[18px] py-3.5 text-[13px] ${
          customer?.wholesaleStatus === "pending" ? "border-warning" : "border-line"
        }`}
      >
        <p>{message}</p>
        <p className="text-[10px] tracking-[0.15em] text-muted uppercase">
          {String(items.length).padStart(2, "0")} {items.length === 1 ? "producto" : "productos"}
        </p>
      </div>
      <ProductList items={items} canBuy={customer !== null} />
    </>
  );
}
