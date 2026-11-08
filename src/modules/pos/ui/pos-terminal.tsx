"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { IDEMPOTENCY_KEY_HEADER } from "@/shared/actions/action-types";
import { ActionButton } from "@/shared/ui/action-button";

import {
  addToCart,
  cartLines,
  changeFor,
  parseCashInput,
  type PosCart,
  type PosCatalogItem,
  POS_ERROR_MESSAGES,
  POS_PAYMENT_LABELS,
  POS_PAYMENT_METHODS,
  type PosPaymentMethod,
  setCartQuantity,
} from "../domain/pos";

// Cashier screen (D-053). No animation anywhere (agents.md §8). The cart lives
// only in this screen; the server prices the sale again and takes the stock.
// "Cobrar" uses ActionButton: locked on the first click until the server
// answers with the tracking_id; after a network error, "Reintentar" sends the
// same key, so a sale is never registered twice.

const COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const cop = (value: number) => COP.format(value).replace(/ /g, " ");

type Props = {
  catalog: PosCatalogItem[];
  customerId: string | null;
  blocked: boolean;
};

export function PosTerminal({ catalog, customerId, blocked }: Props) {
  const router = useRouter();
  const [cart, setCart] = useState<PosCart>({});
  const [filter, setFilter] = useState("");
  const [method, setMethod] = useState<PosPaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? catalog.filter((item) => item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q)) : catalog;
  }, [catalog, filter]);

  const { lines, totalCop } = cartLines(cart, catalog);
  const cashReceived = method === "cash" ? parseCashInput(cashInput) : null;
  const change = method === "cash" ? changeFor(totalCop, cashReceived) : null;
  const unitWord = (item: PosCatalogItem, n: number) =>
    item.saleUnit === "box" ? (n === 1 ? `caja de ${item.unitsPerBox}` : `cajas de ${item.unitsPerBox}`) : n === 1 ? "unidad" : "unidades";

  const missing =
    lines.length === 0
      ? "Agrega productos a la venta."
      : lines.some((line) => line.belowMinimum)
        ? "Un producto no cumple la cantidad mínima."
        : method === "cash" && change === null
          ? "Escribe el efectivo recibido (igual o mayor al total)."
          : !ageConfirmed
            ? "Confirma que verificaste la mayoría de edad del comprador."
            : !online
              ? "Sin conexión a internet: la caja no vende sin conexión."
              : null;

  async function charge(idempotencyKey: string) {
    setError(null);
    const response = await fetch("/api/pos/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json", [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      // Only products, quantities and the payment: never prices.
      body: JSON.stringify({
        items: lines.map((line) => ({ productId: line.item.productId, quantity: line.quantity })),
        paymentMethod: method,
        cashReceivedCop: method === "cash" ? cashReceived : null,
        customerId,
        ageConfirmed,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { trackingId?: string; orderId?: string; error?: string };
    if (response.status !== 202 || !body.trackingId || !body.orderId) {
      if (body.error) setError(POS_ERROR_MESSAGES[body.error] ?? "No se pudo registrar la venta.");
      throw new Error(body.error ?? "request_failed");
    }
    router.push(`/pos?venta=${body.orderId}`);
    return { trackingId: body.trackingId };
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section className="flex flex-col gap-4" aria-label="Productos">
        <label className="field-label">
          Buscar producto
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Nombre o SKU"
            className="field"
            autoComplete="off"
          />
        </label>
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((item) => {
            const inCart = cart[item.productId] ?? 0;
            const soldOut = item.availableSaleUnits === 0 || inCart >= item.availableSaleUnits;
            return (
              <li key={item.productId} className="card flex flex-col gap-2 p-4">
                <p className="font-medium leading-snug">{item.name}</p>
                <p className="text-sm text-muted">
                  {cop(item.priceCop)} {item.saleUnit === "box" ? `por caja de ${item.unitsPerBox}` : "c/u"} · Disponible:{" "}
                  {item.availableSaleUnits}
                </p>
                {/* UI helper, not an action: it only changes the local cart. */}
                <button
                  type="button"
                  disabled={soldOut}
                  onClick={() => setCart((current) => addToCart(current, item))}
                  className="btn btn-secondary btn-sm self-start"
                >
                  {item.availableSaleUnits === 0 ? "Agotado" : inCart > 0 ? `Agregar otra (${inCart})` : "Agregar"}
                </button>
              </li>
            );
          })}
          {visible.length === 0 ? <li className="text-muted">No hay productos con ese nombre.</li> : null}
        </ul>
      </section>

      <section className="card flex flex-col gap-5 p-5" aria-label="Venta">
        <h2 className="font-display text-3xl">Venta</h2>
        {lines.length === 0 ? (
          <p className="text-sm text-muted">Sin productos todavía.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {lines.map((line) => (
              <li key={line.item.productId} className="flex flex-col gap-2 py-3">
                <div className="flex justify-between gap-3">
                  <span className="text-sm">{line.item.name}</span>
                  <span className="text-sm tabular-nums">{cop(line.lineTotalCop)}</span>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <span className="sr-only">Cantidad de {line.item.name}</span>
                  <input
                    type="number"
                    min={0}
                    max={line.item.availableSaleUnits}
                    value={line.quantity}
                    onChange={(e) => setCart((current) => setCartQuantity(current, line.item, Number(e.target.value)))}
                    className="field w-24 py-1"
                  />
                  <span className="text-muted">{unitWord(line.item, line.quantity)}</span>
                </label>
                {line.belowMinimum ? (
                  <span className="field-error">Mínimo {line.item.minQuantity}.</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <p className="flex justify-between border-t border-line pt-3 text-lg font-semibold tabular-nums">
          <span>Total</span>
          <span className="text-gold">{cop(totalCop)}</span>
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Medio de pago</legend>
          {POS_PAYMENT_METHODS.map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="method" checked={method === value} onChange={() => setMethod(value)} />
              {POS_PAYMENT_LABELS[value]}
            </label>
          ))}
        </fieldset>

        {method === "cash" ? (
          <label className="field-label">
            Efectivo recibido
            <input
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              inputMode="numeric"
              placeholder="100.000"
              className="field"
              autoComplete="off"
            />
            <span className="text-sm">
              Cambio: <strong className="tabular-nums">{change === null ? "—" : cop(change)}</strong>
            </span>
          </label>
        ) : null}

        <label className="flex items-start gap-2">
          <input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} className="mt-1" />
          <span>Verifiqué el documento: el comprador es mayor de edad.</span>
        </label>

        {missing && !blocked ? <p className="text-sm text-muted">{missing}</p> : null}
        <ActionButton onAccept={charge} disabled={missing !== null || blocked} className="w-full">
          Cobrar {lines.length > 0 ? cop(totalCop) : ""}
        </ActionButton>
        {error ? (
          <p role="alert" className="notice notice-danger">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
