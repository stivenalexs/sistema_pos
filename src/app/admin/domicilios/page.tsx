import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole } from "@/modules/customers";
import {
  type AdminDelivery,
  assignDeliveryAction,
  createProviderAction,
  encodeAssignment,
  FAILURE_REASON_LABELS,
  formatDistance,
  getDeliveryOptions,
  listDeliveriesForAdmin,
  setProviderActiveAction,
} from "@/modules/delivery";
import { listPickupsAttention, ORDER_STATUS_LABELS, type PickupAttention, resetPickupAttemptsAction } from "@/modules/orders";
import { formatCop } from "@/modules/pricing";
import { IdempotentActionForm } from "@/shared/ui/idempotent-action-form";
import { PageHeader } from "@/shared/ui/page-header";
import { ReasonActionForm } from "@/shared/ui/reason-action-form";

export const metadata: Metadata = { title: "Domicilios · Administración" };

const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
const DAY = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const formatDay = (isoDate: string) => DAY.format(new Date(`${isoDate}T00:00:00Z`));
const TODAY_BOGOTA = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());

// Delivery assignment (D-026, D-045, D-057): paid web orders go to an own
// courier (who then sees them in /courier) or to a third party, tracked here.
export default function DeliveriesPage() {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader size="compact" title="Domicilios">
        Pedidos pagados para entregar. Asígnalos a un mensajero propio, que los verá en su pantalla, o a una empresa
        tercera. Puedes reasignar un pedido mientras va en camino. Un domicilio fallido vuelve a la tienda: según el
        motivo, el cliente elige qué hacer o se reprograma para el día siguiente.
      </PageHeader>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Deliveries />
      </Suspense>
    </section>
  );
}

async function Deliveries() {
  await connection();
  if ((await getStaffRole()) !== "admin") redirect("/login?next=/admin/domicilios");
  const [deliveries, options, pickups] = await Promise.all([
    listDeliveriesForAdmin(),
    getDeliveryOptions(),
    listPickupsAttention(),
  ]);

  const assignmentOptions = [
    ...options.couriers.map((c) => ({
      value: encodeAssignment(c.providerId, c.id),
      label: `Mensajero propio · ${c.name}`,
    })),
    ...options.providers
      .filter((p) => p.kind === "third_party" && p.isActive)
      .map((p) => ({ value: encodeAssignment(p.id, null), label: `Tercero · ${p.name}` })),
  ];
  const awaitingChoice = deliveries.filter((d) => d.awaitingChoice);
  const waiting = deliveries.filter((d) => d.status !== "out_for_delivery" && !d.awaitingChoice);
  const onTheWay = deliveries.filter((d) => d.status === "out_for_delivery");
  const today = TODAY_BOGOTA();

  return (
    <div className="flex flex-col gap-10">
      {assignmentOptions.length === 0 ? (
        <p className="notice notice-warning">
          No hay mensajeros activos ni empresas terceras. Invita mensajeros en Personal o crea una empresa abajo.
        </p>
      ) : null}

      <DeliveryGroup title={`Por asignar (${waiting.length})`} empty="No hay pedidos esperando mensajero.">
        {waiting.map((d) => (
          <DeliveryCard key={d.orderId} delivery={d} options={assignmentOptions} today={today} />
        ))}
      </DeliveryGroup>

      <DeliveryGroup title={`En camino (${onTheWay.length})`} empty="No hay pedidos en camino.">
        {onTheWay.map((d) => (
          <DeliveryCard key={d.orderId} delivery={d} options={assignmentOptions} today={today} />
        ))}
      </DeliveryGroup>

      <DeliveryGroup
        title={`Esperan la decisión del cliente (${awaitingChoice.length})`}
        empty="Ningún domicilio fallido espera al cliente."
      >
        {awaitingChoice.map((d) => (
          <DeliveryCard key={d.orderId} delivery={d} options={assignmentOptions} today={today} />
        ))}
      </DeliveryGroup>

      <DeliveryGroup title={`Recogidas por resolver (${pickups.length})`} empty="No hay recogidas por resolver.">
        {pickups.map((p) => (
          <PickupCard key={p.orderId} pickup={p} />
        ))}
      </DeliveryGroup>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-3xl">Empresas de mensajería</h2>
        <p className="text-sm text-muted">
          Los pedidos de una empresa tercera los sigue el administrador: cuando la empresa entregue, registra la entrega
          desde la pantalla del mensajero con la cédula y la firma.
        </p>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {options.providers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span>
                {p.name}{" "}
                <span className="text-xs text-muted">
                  · {p.kind === "own" ? "mensajeros propios" : "tercero"} · {p.isActive ? "activa" : "inactiva"}
                </span>
              </span>
              {p.kind === "third_party" ? (
                <IdempotentActionForm
                  action={setProviderActiveAction}
                  hidden={{ providerId: p.id, active: String(!p.isActive) }}
                  fields={[]}
                  submitLabel={p.isActive ? "Desactivar" : "Activar"}
                  pendingLabel="Guardando…"
                />
              ) : null}
            </li>
          ))}
        </ul>
        <div className="card flex flex-col gap-3 p-5">
          <h3 className="font-display text-2xl">Nueva empresa tercera</h3>
          <IdempotentActionForm
            action={createProviderAction}
            fields={[{ kind: "text", name: "name", label: "Nombre de la empresa", maxLength: 80 }]}
            submitLabel="Crear empresa"
            pendingLabel="Creando…"
          />
        </div>
      </div>
    </div>
  );
}

function DeliveryGroup({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-display text-3xl">{title}</h2>
      {children.length === 0 ? <p className="text-sm text-muted">{empty}</p> : <ul className="flex flex-col gap-3">{children}</ul>}
    </div>
  );
}

function DeliveryCard({
  delivery: d,
  options,
  today,
}: {
  delivery: AdminDelivery;
  options: { value: string; label: string }[];
  /** YYYY-MM-DD in Colombia. */
  today: string;
}) {
  // Preselect the current assignment only if it is still offered: with a
  // value that matches no option, the browser would select the first courier.
  const assigned = d.providerId ? encodeAssignment(d.providerId, d.courierId) : undefined;
  const current = options.some((o) => o.value === assigned) ? assigned : undefined;
  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {d.addressLine}
          {d.details ? `, ${d.details}` : ""} <span className="text-sm text-muted">· {d.municipality}</span>
        </p>
        <p className="text-lg text-gold tabular-nums">{formatCop(d.totalCop)}</p>
      </div>
      <p className="text-xs text-muted">
        Pedido {d.orderId.slice(0, 8).toUpperCase()} · {ORDER_STATUS_LABELS[d.status] ?? d.status}
        {d.paidAt ? ` · pagó el ${DATE.format(new Date(d.paidAt))}` : ""} · {formatDistance(d.distanceM)} ·{" "}
        {d.totalUnits} {d.totalUnits === 1 ? "unidad" : "unidades"} · {d.contactName ?? "—"} {d.contactPhone ?? ""}
      </p>
      {d.status === "out_for_delivery" ? (
        <p className="text-sm">
          En camino con <strong>{d.courier ?? d.provider ?? "—"}</strong>
          {d.externalRef ? ` (guía ${d.externalRef})` : ""}
          {d.assignedAt ? ` · desde el ${DATE.format(new Date(d.assignedAt))}` : ""}
        </p>
      ) : null}
      {d.lastFailure ? (
        <p role="status" className="notice notice-warning text-sm">
          {d.returnedAt ? "Volvió a la tienda" : "Intento fallido"} el {DATE.format(new Date(d.lastFailure.at))}:{" "}
          {FAILURE_REASON_LABELS[d.lastFailure.reason] ?? d.lastFailure.reason}
          {d.lastFailure.notes ? ` — ${d.lastFailure.notes}` : ""}.
        </p>
      ) : null}
      {d.scheduledDeliveryOn && d.status !== "out_for_delivery" ? (
        <p className="text-sm">
          <span className="badge">{d.scheduledDeliveryOn <= today ? "Sale hoy" : "Programado"}</span> Enviar el{" "}
          {formatDay(d.scheduledDeliveryOn)}
          {d.returnChoice === "reschedule" ? " (lo pidió el cliente)" : d.returnKind === "force_majeure" ? " (fuerza mayor)" : ""}.
        </p>
      ) : null}
      {d.awaitingChoice ? (
        <p className="text-sm text-muted">
          Esperando que el cliente elija: recoger, reprogramar o reembolso
          {d.returnChoiceDeadline ? `, hasta el ${DATE.format(new Date(d.returnChoiceDeadline))}` : ""}. Si no elige,
          queda para recoger en la tienda.
        </p>
      ) : (
      <IdempotentActionForm
        action={assignDeliveryAction}
        hidden={{ orderId: d.orderId }}
        fields={[
          { kind: "select", name: "assignment", label: "Entregar con", options, defaultValue: current },
          {
            kind: "text",
            name: "externalRef",
            label: "Guía del tercero (opcional; se ignora con mensajero propio)",
            required: false,
            maxLength: 100,
            defaultValue: d.externalRef ?? undefined,
          },
        ]}
        submitLabel={d.status === "out_for_delivery" ? "Reasignar" : "Asignar"}
        pendingLabel="Asignando…"
        variant={d.status === "out_for_delivery" ? "secondary" : "primary"}
      />
      )}
    </li>
  );
}

// Pickups the store resolves (D-067, D-068).
function PickupCard({ pickup: p }: { pickup: PickupAttention }) {
  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{p.customer}</p>
        <p className="text-lg text-gold tabular-nums">{formatCop(p.totalCop)}</p>
      </div>
      <p className="text-xs text-muted">
        Pedido {p.orderId.slice(0, 8).toUpperCase()} · {ORDER_STATUS_LABELS[p.status] ?? p.status}
        {p.paidAt ? ` · pagó el ${DATE.format(new Date(p.paidAt))}` : ""}
        {p.defaulted ? " · quedó para recoger porque el cliente no eligió en 3 días" : ""}
      </p>
      {p.reason === "locked" ? (
        <>
          <p role="status" className="notice notice-warning text-sm">
            Bloqueada tras {p.failedAttempts} documentos equivocados. Verifica la cédula en la tienda y reinicia los
            intentos para que el cliente confirme.
          </p>
          <ReasonActionForm
            action={resetPickupAttemptsAction}
            hidden={{ orderId: p.orderId }}
            fields={[{ name: "reason", label: "Motivo (queda en el historial del pedido)" }]}
            submitLabel="Reiniciar intentos"
            pendingLabel="Reiniciando…"
          />
        </>
      ) : (
        <p role="status" className="notice notice-info text-sm">
          Sin cédula registrada: el cliente debe escribirla en la página de su pedido antes de confirmar la recogida.
        </p>
      )}
    </li>
  );
}
