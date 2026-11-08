import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getCurrentCustomer } from "@/modules/customers";
import { getOrder, OrderSummary, PaymentStatusRefresher } from "@/modules/orders";
import { recordPaymentRedirect } from "@/modules/payments";
import { isUuid } from "@/shared/actions/action-types";
import { PageHeader } from "@/shared/ui/page-header";

export const metadata: Metadata = { title: "Estado de tu pago" };

// Return page after the Wompi checkout (D-040). It NEVER confirms a payment:
// the ?id= is stored only as a hint for the reconciliation job, and the page
// shows the order status, which only the webhook changes.
export default function PaymentReturnPage({ params, searchParams }: PageProps<"/orders/[id]/payment-return">) {
  return (
    <section className="page-narrow flex flex-col gap-10">
      <PageHeader eyebrow="Tu compra" title="Estado de tu pago" />
      <Suspense fallback={<p className="text-muted">Consultando tu pedido…</p>}>
        <PaymentReturn params={params} searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function PaymentReturn({
  params,
  searchParams,
}: Pick<PageProps<"/orders/[id]/payment-return">, "params" | "searchParams">) {
  await connection();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const customer = await getCurrentCustomer();
  if (!customer) redirect(`/login?next=/orders/${id}`);

  const query = await searchParams;
  await recordPaymentRedirect(id, typeof query.id === "string" ? query.id : null);

  const order = await getOrder(id);
  if (!order) notFound();
  const waiting = order.status === "awaiting_payment";

  return (
    <>
      {waiting ? (
        <p role="status" className="notice notice-info">
          Estamos confirmando tu pago con Wompi. Esta página se actualiza sola; si pagaste con PSE puede
          tardar unos minutos.
        </p>
      ) : null}
      <PaymentStatusRefresher active={waiting} />
      <OrderSummary order={order} />
    </>
  );
}
