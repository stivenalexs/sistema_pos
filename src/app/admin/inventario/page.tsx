import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole } from "@/modules/customers";
import {
  getInventoryAlerts,
  getInventoryOverview,
  getRecentMovements,
  MAX_COUNT_UNITS,
  MAX_MOVEMENT_UNITS,
  recordCountAction,
  recordEntryAction,
  recordWasteAction,
  type StockRow,
} from "@/modules/inventory";
import { IdempotentActionForm } from "@/shared/ui/idempotent-action-form";
import { PageHeader } from "@/shared/ui/page-header";

import { MovementList } from "./movement-list";

export const metadata: Metadata = { title: "Inventario · Administración" };

type SearchParams = Promise<{ reservas?: string }>;

// Inventory (D-038, D-056), for admin and warehouse. Stock changes only
// through the movements recorded here and by sales; nothing edits a balance.
export default function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader size="compact" title="Inventario">
        Existencias compartidas por la tienda web y el POS, en unidades. Disponible = existencias menos lo reservado para
        pedidos web pendientes de pago.
      </PageHeader>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Inventory searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function Inventory({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const role = await getStaffRole();
  if (role !== "admin" && role !== "warehouse") redirect("/login?next=/admin/inventario");
  const includeReservations = (await searchParams).reservas === "1";
  const [stock, alerts, movements] = await Promise.all([
    getInventoryOverview(),
    getInventoryAlerts(),
    getRecentMovements({ includeReservations }),
  ]);
  const products = stock
    .filter((p) => p.isActive)
    .map((p) => ({ value: p.productId, label: `${p.name} · ${p.sku}` }));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        {alerts.stockMismatches > 0 ? (
          <p role="alert" className="notice notice-danger">
            {alerts.stockMismatches} {alerts.stockMismatches === 1 ? "producto tiene" : "productos tienen"} un saldo que no
            coincide con su libro de movimientos. No registres ajustes sobre ellos y avisa al responsable técnico.
          </p>
        ) : null}
        {alerts.lowStock > 0 ? (
          <p role="status" className="notice notice-warning">
            {alerts.lowStock} {alerts.lowStock === 1 ? "producto activo está" : "productos activos están"} en el umbral de
            stock bajo o por debajo.
          </p>
        ) : (
          <p className="notice notice-success">Ningún producto activo está en stock bajo.</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card flex flex-col gap-3 p-5">
          <h2 className="font-display text-2xl">Entrada de mercancía</h2>
          <p className="text-sm text-muted">Con el número de la factura de compra o la remisión.</p>
          <IdempotentActionForm
            action={recordEntryAction}
            fields={[
              { kind: "select", name: "productId", label: "Producto", options: products },
              { kind: "number", name: "units", label: "Unidades que entran", min: 1, max: MAX_MOVEMENT_UNITS },
              { kind: "text", name: "reference", label: "Factura o remisión", maxLength: 120 },
              { kind: "text", name: "note", label: "Nota (opcional)", required: false },
            ]}
            submitLabel="Registrar entrada"
          />
        </div>
        <div className="card flex flex-col gap-3 p-5">
          <h2 className="font-display text-2xl">Conteo físico</h2>
          <p className="text-sm text-muted">
            Escribe cuántas unidades hay en bodega; la diferencia con las existencias queda como ajuste.
          </p>
          <IdempotentActionForm
            action={recordCountAction}
            fields={[
              { kind: "select", name: "productId", label: "Producto", options: products },
              { kind: "number", name: "counted", label: "Unidades contadas", min: 0, max: MAX_COUNT_UNITS },
              { kind: "text", name: "reason", label: "Motivo", placeholder: "Conteo semanal" },
            ]}
            submitLabel="Registrar conteo"
          />
        </div>
        <div className="card flex flex-col gap-3 p-5">
          <h2 className="font-display text-2xl">Merma</h2>
          <p className="text-sm text-muted">Botellas rotas, vencidas o perdidas. Solo sale lo disponible.</p>
          <IdempotentActionForm
            action={recordWasteAction}
            fields={[
              { kind: "select", name: "productId", label: "Producto", options: products },
              { kind: "number", name: "units", label: "Unidades perdidas", min: 1, max: MAX_MOVEMENT_UNITS },
              { kind: "text", name: "reason", label: "Motivo", placeholder: "Botellas rotas al descargar" },
            ]}
            submitLabel="Registrar merma"
          />
        </div>
      </div>

      <StockTable stock={stock} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-3xl">Movimientos recientes</h2>
          <Link href={includeReservations ? "/admin/inventario" : "/admin/inventario?reservas=1"} className="link text-sm">
            {includeReservations ? "Ocultar reservas web" : "Mostrar también reservas web"}
          </Link>
        </div>
        <MovementList movements={movements} showProduct />
      </div>
    </div>
  );
}

function StockTable({ stock }: { stock: StockRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-display text-3xl">Existencias</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-normal">Producto</th>
              <th className="py-2 pr-3 text-right font-normal">Existencias</th>
              <th className="py-2 pr-3 text-right font-normal">Reservado</th>
              <th className="py-2 pr-3 text-right font-normal">Disponible</th>
              <th className="py-2 pr-3 text-right font-normal">Umbral</th>
              <th className="py-2 pr-3 text-right font-normal">Colchón web</th>
              <th className="py-2 font-normal">Estado</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((p) => (
              <tr key={p.productId} className="border-b border-line">
                <td className="py-2 pr-3">
                  <Link href={`/admin/inventario/${p.productId}`} className="link">
                    {p.name}
                  </Link>
                  <span className="block text-xs text-muted">
                    {p.sku} · {p.origin === "imported" ? "Importado" : "Nacional"} · caja de {p.unitsPerBox}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{p.onHand.toLocaleString("es-CO")}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{p.reserved.toLocaleString("es-CO")}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{p.available.toLocaleString("es-CO")}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{p.lowStockThreshold.toLocaleString("es-CO")}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{p.webSafetyStock.toLocaleString("es-CO")}</td>
                <td className="py-2">
                  {!p.isActive ? (
                    <span className="badge">Inactivo</span>
                  ) : p.isLow ? (
                    <span className="badge text-warning">Stock bajo</span>
                  ) : (
                    <span className="badge">Normal</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
