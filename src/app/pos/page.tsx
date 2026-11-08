import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getSalesBlock, SalesBlockNotice } from "@/modules/compliance";
import { formatCop } from "@/modules/pricing";
import {
  findPosCustomer,
  getPosCatalog,
  getPosReceipt,
  getPosStaff,
  POS_PAYMENT_LABELS,
  PosTerminal,
} from "@/modules/pos";
import { isUuid } from "@/shared/actions/action-types";
import { PageHeader } from "@/shared/ui/page-header";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Cashier screen (D-053). No animation (agents.md §8). The buyer is
// "consumidor final" by default; a registered customer can be identified by
// cédula/NIT or email to use their price list (D-033).
export default function PosPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <section className="page flex flex-col gap-8 pt-9">
      <PageHeader eyebrow="Caja" title="Punto de venta" />
      <Suspense fallback={<p className="text-muted">Cargando caja…</p>}>
        <Pos searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

async function Pos({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const staff = await getPosStaff();
  if (!staff) redirect("/login?next=/pos");

  const params = await searchParams;
  const saleId = one(params.venta);
  if (saleId && isUuid(saleId)) return <Receipt orderId={saleId} />;

  const search = one(params.buscar)?.trim() ?? "";
  const wanted = one(params.cliente);
  const [found, block] = await Promise.all([
    search ? findPosCustomer(search) : Promise.resolve(null),
    getSalesBlock({ channel: "pos" }),
  ]);
  const customerId = wanted && isUuid(wanted) ? wanted : null;
  const catalog = await getPosCatalog(customerId);

  return (
    <div className="flex flex-col gap-6">
      {block ? <SalesBlockNotice block={block} /> : null}

      <div className="card flex flex-col gap-3 p-5">
        <p className="text-sm">
          Comprador:{" "}
          <strong>{customerId && catalog.ok ? "cliente identificado" : "consumidor final (precio al detal)"}</strong>
          {customerId ? (
            <>
              {" · "}
              <Link href="/pos" className="link">
                Quitar cliente
              </Link>
            </>
          ) : null}
        </p>
        {customerId && catalog.ok && catalog.saleUnit === "box" ? (
          <p className="text-sm text-muted">Mayorista aprobado: vende por caja con su lista de precios.</p>
        ) : null}
        {!catalog.ok ? <p className="notice notice-danger">No encontramos ese cliente. Vende como consumidor final.</p> : null}
        <form method="get" action="/pos" className="flex flex-wrap items-end gap-3">
          <label className="field-label grow">
            Buscar cliente registrado
            <input name="buscar" defaultValue={search} placeholder="Cédula, NIT o correo" className="field" autoComplete="off" />
          </label>
          {/* A search is navigation (GET), not an action. */}
          <button type="submit" className="btn btn-secondary btn-sm">
            Buscar
          </button>
        </form>
        {search ? (
          found ? (
            <p className="text-sm">
              {found.fullName} ({found.customerType === "wholesale" ? `mayorista ${found.wholesaleStatus === "approved" ? "aprobado" : "pendiente"}` : "minorista"}){" · "}
              <Link href={`/pos?cliente=${found.id}`} className="link">
                Usar este cliente
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted">No hay un cliente registrado con «{search}».</p>
          )
        ) : null}
      </div>

      <PosTerminal
        // A different buyer is a different sale: start a fresh cart.
        key={customerId ?? "final"}
        catalog={catalog.ok ? catalog.items : []}
        customerId={catalog.ok ? customerId : null}
        blocked={block !== null}
      />
    </div>
  );
}

const INVOICE_LABELS: Record<string, string> = {
  pending: "en proceso",
  sent: "enviada, esperando a la DIAN",
  accepted: "aceptada",
  rejected: "rechazada (la revisa el administrador)",
};

async function Receipt({ orderId }: { orderId: string }) {
  const receipt = await getPosReceipt(orderId);
  if (!receipt) {
    return <p className="notice notice-danger">No encontramos esa venta.</p>;
  }
  return (
    <div className="card mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <p role="status" className="notice notice-success">
        Venta registrada.
      </p>
      <p className="text-sm text-muted">Venta {receipt.orderId.slice(0, 8).toUpperCase()}</p>
      <ul className="flex flex-col divide-y divide-line text-sm">
        {receipt.items.map((item) => (
          <li key={item.name} className="flex justify-between gap-3 py-2">
            <span>
              {item.quantity} {item.saleUnit === "box" ? "caja(s)" : "und."} · {item.name}
            </span>
            <span className="tabular-nums">{formatCop(item.lineTotalCop)}</span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between text-lg font-semibold tabular-nums">
        <span>Total</span>
        <span className="text-gold">{formatCop(receipt.totalCop)}</span>
      </p>
      <p className="text-sm">Pago: {POS_PAYMENT_LABELS[receipt.paymentMethod]}</p>
      {receipt.paymentMethod === "cash" && receipt.changeCop !== null ? (
        <p className="text-lg">
          Cambio: <strong className="tabular-nums">{formatCop(receipt.changeCop)}</strong>
        </p>
      ) : null}
      <p className="text-sm text-muted">
        Factura electrónica: {receipt.invoiceStatus ? INVOICE_LABELS[receipt.invoiceStatus] ?? receipt.invoiceStatus : "en cola"}.
      </p>
      <Link href="/pos" className="btn btn-primary w-full text-center">
        Nueva venta
      </Link>
    </div>
  );
}
