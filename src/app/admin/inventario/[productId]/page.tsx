import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole } from "@/modules/customers";
import {
  getInventoryOverview,
  getRecentMovements,
  isUuid,
  MAX_SETTING_UNITS,
  setStockSettingsAction,
  unitsWithBoxes,
} from "@/modules/inventory";
import { IdempotentActionForm } from "@/shared/ui/idempotent-action-form";
import { PageHeader } from "@/shared/ui/page-header";

import { MovementList } from "../movement-list";

type Params = Promise<{ productId: string }>;

// One product: balance, stock settings and its movements (D-056).
export default function ProductInventoryPage({ params }: { params: Params }) {
  return (
    <section className="flex flex-col gap-8">
      <Link href="/admin/inventario" className="link text-sm">
        ← Inventario
      </Link>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <ProductInventory params={params} />
      </Suspense>
    </section>
  );
}

async function ProductInventory({ params }: { params: Params }) {
  await connection();
  const { productId } = await params;
  const role = await getStaffRole();
  if (role !== "admin" && role !== "warehouse") redirect(`/login?next=/admin/inventario/${productId}`);
  if (!isUuid(productId)) notFound();
  const product = (await getInventoryOverview()).find((p) => p.productId === productId);
  if (!product) notFound();
  const movements = await getRecentMovements({ productId, includeReservations: true, limit: 100 });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow={product.sku} title={product.name}>
        {product.origin === "imported" ? "Importado" : "Nacional"} · caja de {product.unitsPerBox} ·{" "}
        {product.isActive ? "activo" : "inactivo"}
      </PageHeader>

      <dl className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Existencias", value: product.onHand },
          { label: "Reservado para pedidos web", value: product.reserved },
          { label: "Disponible", value: product.available },
        ].map((item) => (
          <div key={item.label} className="card flex flex-col gap-1 p-5">
            <dt className="text-sm text-muted">{item.label}</dt>
            <dd className="font-display text-3xl text-gold tabular-nums">
              {unitsWithBoxes(item.value, product.unitsPerBox)}
            </dd>
          </div>
        ))}
      </dl>
      {product.isLow ? (
        <p role="status" className="notice notice-warning">
          Stock bajo: lo disponible está en el umbral o por debajo.
        </p>
      ) : null}

      <div className="card flex flex-col gap-3 p-5">
        <h2 className="font-display text-2xl">Alertas y colchón web</h2>
        <p className="text-sm text-muted">
          <strong>Umbral de stock bajo:</strong> aparece la alerta cuando lo disponible llega a este número.{" "}
          <strong>Colchón web:</strong> unidades que la tienda web no vende ni muestra, para que el POS no se quede sin
          producto. El POS sí puede venderlas. Ambos en unidades.
        </p>
        <IdempotentActionForm
          action={setStockSettingsAction}
          hidden={{ productId: product.productId }}
          fields={[
            {
              kind: "number",
              name: "lowStockThreshold",
              label: "Umbral de stock bajo",
              min: 0,
              max: MAX_SETTING_UNITS,
              defaultValue: String(product.lowStockThreshold),
            },
            {
              kind: "number",
              name: "webSafetyStock",
              label: "Colchón web",
              min: 0,
              max: MAX_SETTING_UNITS,
              defaultValue: String(product.webSafetyStock),
            },
          ]}
          submitLabel="Guardar"
          pendingLabel="Guardando…"
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-3xl">Movimientos</h2>
        <p className="text-sm text-muted">Los últimos 100, incluidas las reservas web.</p>
        <MovementList movements={movements} showProduct={false} />
      </div>
    </div>
  );
}
