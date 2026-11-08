import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import {
  CHANNEL_LABELS,
  getSalesBlocksOverview,
  isoToBogotaLocal,
  type SalesBlockChange,
  type SalesBlockRule,
  saveSalesBlockAction,
  setSalesBlockActiveAction,
  WEEKDAY_LABELS,
} from "@/modules/compliance";
import { getStaffRole } from "@/modules/customers";
import { getConfigOverview } from "@/modules/delivery";
import { type IdempotentField, IdempotentActionForm } from "@/shared/ui/idempotent-action-form";
import { PageHeader } from "@/shared/ui/page-header";

const DATE = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const STAMP = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
const OPERATION_LABELS: Record<string, string> = { insert: "creó", update: "cambió", delete: "borró" };
const FIELD_LABELS: Record<string, string> = {
  name: "nombre",
  kind: "tipo",
  zone_id: "municipio",
  channels: "canales",
  starts_at: "inicio",
  ends_at: "fin",
  weekdays: "días",
  start_time: "hora de inicio",
  end_time: "hora de fin",
  message: "mensaje",
  is_active: "activa",
};

type Zone = { id: string; municipality: string };

// Sales block rules (ley seca, schedules) by municipality, date and time
// (D-051, D-060). The database blocks orders, payments and POS sales while a
// rule applies; this page creates and edits the rules and shows what is
// blocked right now.
export default function SalesBlocksPage() {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader eyebrow="Panel" title="Bloqueos de venta">
        Ley seca, horarios y otras restricciones por municipio, fecha y hora. Mientras una regla aplica, la tienda web no
        deja pedir ni pagar y el POS no deja cobrar. Todas las horas son de Colombia.
      </PageHeader>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <SalesBlocks />
      </Suspense>
    </section>
  );
}

async function SalesBlocks() {
  await connection();
  if ((await getStaffRole()) !== "admin") redirect("/login?next=/admin/bloqueos");
  const [overview, config] = await Promise.all([getSalesBlocksOverview(), getConfigOverview()]);
  const zones: Zone[] = config.zones.map((z) => ({ id: z.id, municipality: z.municipality }));
  const storeZone = zones.find((z) => z.id === overview.storeZoneId)?.municipality;

  return (
    <div className="flex flex-col gap-10">
      {overview.blockedNow.length === 0 ? (
        <p className="notice notice-success">Ahora mismo se puede vender en todos los municipios, en la web y en el POS.</p>
      ) : (
        <div role="status" className="notice notice-warning flex flex-col gap-1">
          <p className="font-medium">Ventas bloqueadas ahora mismo:</p>
          <ul className="flex flex-col gap-0.5 text-sm">
            {overview.blockedNow.map((b) => (
              <li key={`${b.zoneId}-${b.channel}`}>
                {b.municipality}
                {b.municipality === storeZone ? " (tienda)" : ""} · {CHANNEL_LABELS[b.channel]} · {b.name} · hasta el{" "}
                {DATE.format(new Date(b.endsAt))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-3xl">Reglas</h2>
        <p className="text-sm text-muted">
          Recoger en tienda y el POS usan el municipio de la tienda{storeZone ? ` (${storeZone})` : ""}; los domicilios, el
          de la dirección. Las reglas no se borran: se desactivan.
        </p>
        {overview.rules.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay reglas.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {overview.rules.map((r) => (
              <li key={r.id} className={`card flex flex-col gap-3 p-4 ${r.isActive ? "" : "opacity-80"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {r.name}{" "}
                    <span className="text-xs text-muted">
                      · {!r.isActive ? "inactiva" : r.blockingUntil ? "bloqueando ahora" : "activa"}
                    </span>
                  </p>
                  {r.isActive && r.blockingUntil ? (
                    <span className="badge text-warning">Hasta el {DATE.format(new Date(r.blockingUntil))}</span>
                  ) : null}
                </div>
                <p className="text-sm">{describeRule(r)}</p>
                <p className="text-sm text-muted">«{r.message}»</p>
                <p className="text-xs text-muted">
                  Creada por {r.createdBy ?? "—"} el {STAMP.format(new Date(r.createdAt))}
                  {r.updatedAt !== r.createdAt && r.updatedBy
                    ? ` · último cambio de ${r.updatedBy} el ${STAMP.format(new Date(r.updatedAt))}`
                    : ""}
                </p>
                <details>
                  <summary className="link cursor-pointer text-sm">Editar</summary>
                  <div className="pt-3">
                    <IdempotentActionForm
                      action={saveSalesBlockAction}
                      hidden={{ ruleId: r.id, kind: r.kind }}
                      fields={ruleFields(r.kind, zones, r)}
                      submitLabel="Guardar cambios"
                      pendingLabel="Guardando…"
                    />
                  </div>
                </details>
                <IdempotentActionForm
                  action={setSalesBlockActiveAction}
                  hidden={{ ruleId: r.id, active: String(!r.isActive) }}
                  fields={[]}
                  submitLabel={r.isActive ? "Desactivar regla" : "Activar regla"}
                  pendingLabel="Guardando…"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card flex flex-col gap-3 p-5">
          <h3 className="font-display text-2xl">Nuevo rango de fechas</h3>
          <p className="text-sm text-muted">Por ejemplo, una ley seca por elecciones: bloquea de un momento a otro.</p>
          <IdempotentActionForm
            action={saveSalesBlockAction}
            hidden={{ kind: "date_range" }}
            fields={ruleFields("date_range", zones, null)}
            submitLabel="Crear regla"
            pendingLabel="Creando…"
          />
        </div>
        <div className="card flex flex-col gap-3 p-5">
          <h3 className="font-display text-2xl">Nueva franja semanal</h3>
          <p className="text-sm text-muted">
            Se repite cada semana en los días elegidos (el día en que empieza la franja). Si la hora de fin es menor que la
            de inicio, la franja cruza la medianoche (por ejemplo, de 22:00 a 10:00).
          </p>
          <IdempotentActionForm
            action={saveSalesBlockAction}
            hidden={{ kind: "weekly" }}
            fields={ruleFields("weekly", zones, null)}
            submitLabel="Crear regla"
            pendingLabel="Creando…"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-3xl">Cambios recientes</h2>
        {overview.changes.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay cambios registrados.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {overview.changes.map((c) => (
              <li key={`${c.blockId}-${c.createdAt}-${c.operation}`} className="flex flex-col py-2 text-sm">
                <span>
                  {c.actor ?? "Sistema"} {OPERATION_LABELS[c.operation] ?? c.operation} la regla {describeChange(c)}
                </span>
                <span className="text-xs text-muted">{STAMP.format(new Date(c.createdAt))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function describeRule(r: SalesBlockRule): string {
  const where = r.municipality ?? "Todo el departamento";
  const channels = r.channels.map((c) => CHANNEL_LABELS[c]).join(" y ");
  if (r.kind === "date_range") {
    return `${where} · ${channels} · del ${DATE.format(new Date(r.startsAt!))} al ${DATE.format(new Date(r.endsAt!))}`;
  }
  const days = (r.weekdays ?? []).map((d) => WEEKDAY_LABELS[d]?.slice(0, 3).toLowerCase()).join(", ");
  const crosses = r.startTime && r.endTime && r.endTime < r.startTime ? " (del día siguiente)" : "";
  const validity = [
    r.startsAt ? `desde el ${DATE.format(new Date(r.startsAt))}` : null,
    r.endsAt ? `hasta el ${DATE.format(new Date(r.endsAt))}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${where} · ${channels} · ${days} de ${r.startTime} a ${r.endTime}${crosses}${validity ? ` · ${validity}` : ""}`;
}

function ruleFields(kind: "date_range" | "weekly", zones: Zone[], r: SalesBlockRule | null): IdempotentField[] {
  const common: IdempotentField[] = [
    { kind: "text", name: "name", label: "Nombre", maxLength: 80, defaultValue: r?.name },
    {
      kind: "select",
      name: "zoneId",
      label: "Municipio",
      options: [{ value: "all", label: "Todo el departamento" }, ...zones.map((z) => ({ value: z.id, label: z.municipality }))],
      defaultValue: r ? (r.zoneId ?? "all") : undefined,
    },
    {
      kind: "checkboxes",
      name: "channels",
      label: "Canales",
      options: [
        { value: "web", label: CHANNEL_LABELS.web },
        { value: "pos", label: CHANNEL_LABELS.pos },
      ],
      defaultValue: r ? r.channels.join(",") : "web,pos",
    },
  ];
  const timing: IdempotentField[] =
    kind === "date_range"
      ? [
          { kind: "datetime", name: "startsAt", label: "Desde", defaultValue: r ? isoToBogotaLocal(r.startsAt) : undefined },
          { kind: "datetime", name: "endsAt", label: "Hasta", defaultValue: r ? isoToBogotaLocal(r.endsAt) : undefined },
        ]
      : [
          {
            kind: "checkboxes",
            name: "weekdays",
            label: "Días en que empieza la franja",
            options: Object.entries(WEEKDAY_LABELS).map(([value, label]) => ({ value, label })),
            defaultValue: r?.weekdays?.join(","),
          },
          { kind: "time", name: "startTime", label: "Hora de inicio", defaultValue: r?.startTime ?? undefined },
          { kind: "time", name: "endTime", label: "Hora de fin", defaultValue: r?.endTime ?? undefined },
          {
            kind: "datetime",
            name: "startsAt",
            label: "Vigente desde (opcional)",
            required: false,
            defaultValue: r ? isoToBogotaLocal(r.startsAt) : undefined,
          },
          {
            kind: "datetime",
            name: "endsAt",
            label: "Vigente hasta (opcional)",
            required: false,
            defaultValue: r ? isoToBogotaLocal(r.endsAt) : undefined,
          },
        ];
  return [
    ...common,
    ...timing,
    {
      kind: "text",
      name: "message",
      label: "Mensaje para el cliente y el cajero",
      maxLength: 300,
      defaultValue: r?.message,
      placeholder: "Ley seca por elecciones: no se venden bebidas alcohólicas.",
    },
  ];
}

function describeChange(c: SalesBlockChange): string {
  const name = c.name ?? "—";
  if (c.operation !== "update" || !c.oldRow || !c.newRow) return name;
  const changed = Object.keys(FIELD_LABELS).filter(
    (k) => JSON.stringify(c.newRow![k]) !== JSON.stringify(c.oldRow![k]),
  );
  if (changed.length === 1 && changed[0] === "is_active") {
    return `${name} (${c.newRow.is_active ? "se activó" : "se desactivó"})`;
  }
  return `${name} (${changed.map((k) => FIELD_LABELS[k]).join(", ")})`;
}
