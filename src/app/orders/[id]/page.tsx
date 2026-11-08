import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { isUuid } from "@/shared/actions/action-types";
import { getCurrentCustomer } from "@/modules/customers";
import { getOrder, OrderSummary } from "@/modules/orders";
import { PageHeader } from "@/shared/ui/page-header";

export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <section className="page-narrow flex flex-col gap-10">
      <PageHeader eyebrow="Tu compra" title="Pedido" />
      <Suspense fallback={<p className="text-muted">Cargando pedido…</p>}>
        <Order params={params} />
      </Suspense>
    </section>
  );
}

async function Order({ params }: Pick<PageProps<"/orders/[id]">, "params">) {
  await connection();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const customer = await getCurrentCustomer();
  if (!customer) redirect(`/login?next=/orders/${id}`);

  // RLS: another customer's order is not found.
  const order = await getOrder(id);
  if (!order) notFound();

  return <OrderSummary order={order} />;
}
