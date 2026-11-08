import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getStaffRole } from "@/modules/customers";
import {
  type ConfigChange,
  type FeeRule,
  formatDistance,
  getConfigOverview,
  MAP_DEFAULT_CENTER,
  saveFeeRuleAction,
  saveStoreSettingsAction,
  setFeeRuleActiveAction,
  setZoneActiveAction,
  StoreSettingsForm,
} from "@/modules/delivery";
import { formatCop } from "@/modules/pricing";
import { type IdempotentField, IdempotentActionForm } from "@/shared/ui/idempotent-action-form";
import { PageHeader } from "@/shared/ui/page-header";

const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
const CUSTOMER_TYPE_LABELS = { any: "Todos los clientes", retail: "Minoristas", wholesale: "Mayoristas (por caja)" };
const TABLE_LABELS: Record<string, string> = {
  app_settings: "Datos de la tienda",
  delivery_zones: "Municipio",
  delivery_fee_rules: "Tarifa",
  delivery_providers: "Empresa de mensajería",
};
const OPERATION_LABELS: Record<string, string> = { INSERT: "creó", UPDATE: "cambió", DELETE: "borró" };
const FIELD_LABELS: Record<string, string> = {
  name: "nombre",
  customer_type: "clientes",
  min_boxes: "cajas mínimas",
  max_distance_m: "distancia máxima",
  fee_cop: "valor",
  is_active: "activa",
  kind: "tipo",
};
const SETTING_LABELS: Record<string, string> = {
  store_location: "ubicación",
  store_zone_id: "municipio",
  delivery_max_distance_m: "radio máximo",
};

// Store settings, delivery zones and fee rules (D-045, D-058). Every change
// is recorded with who made it (config_changes).
export default function ConfigurationPage() {
  return (
    <section className="flex flex-col gap-8">
      <PageHeader eyebrow="Panel" title="Configuración">
        Dónde está la tienda, a qué municipios se lleva domicilio y cuánto cuesta. Cada cambio queda registrado con quién
        lo hizo.
      </PageHeader>
      <Suspense fallback={<p className="text-muted">Cargando…</p>}>
        <Configuration />
      </Suspense>
    </section>
  );
}

async function Configuration() {
  await connection();
  if ((await getStaffRole()) !== "admin") redirect("/login?next=/admin/configuracion");
  const config = await getConfigOverview();
  const general = config.feeRules.filter((r) => r.isActive && r.customerType === null && r.minBoxes === null);
  const coversAnyDistance = general.some((r) => r.maxDistanceM === null);

  return (
    <div className="flex flex-col gap-10">
      <div className="card flex flex-col gap-3 p-5">
        <h2 className="font-display text-2xl">Tienda</h2>
        <StoreSettingsForm
          action={saveStoreSettingsAction}
          initial={config.store}
          zones={config.zones}
          center={MAP_DEFAULT_CENTER}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-3xl">Municipios con domicilio</h2>
        <p className="text-sm text-muted">
          Los 10 municipios del Valle de Aburrá. Desactivar uno impide guardar direcciones nuevas allí y pedir domicilio
          a las que ya existen; no afecta los pedidos ya hechos.
        </p>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {config.zones.map((z) => (
            <li key={z.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span>
                {z.municipality}{" "}
                <span className="text-xs text-muted">
                  · DANE {z.daneCode} · {z.addresses} {z.addresses === 1 ? "dirección" : "direcciones"} ·{" "}
                  {z.isActive ? "con domicilio" : "sin domicilio"}
                </span>
              </span>
              <IdempotentActionForm
                action={setZoneActiveAction}
                hidden={{ zoneId: z.id, active: String(!z.isActive) }}
                fields={[]}
                submitLabel={z.isActive ? "Desactivar" : "Activar"}
                pendingLabel="Guardando…"
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-3xl">Tarifas de domicilio</h2>
        <p className="text-sm text-muted">
          Para cada pedido se usa la tarifa activa más barata que aplique (tipo de cliente, cajas mínimas y distancia
          máxima; un campo vacío aplica a todos). Las tarifas no se borran: se desactivan.
        </p>
        {!coversAnyDistance ? (
          <p role="alert" className="notice notice-warning">
            No hay una tarifa activa para todos los clientes sin límite de distancia: algunos domicilios no tendrán
            tarifa y no se podrán pedir.
          </p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {config.feeRules.map((r) => (
            <li key={r.id} className={`card flex flex-col gap-3 p-4 ${r.isActive ? "" : "opacity-80"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {r.name} <span className="text-xs text-muted">· {r.isActive ? "activa" : "inactiva"}</span>
                </p>
                <p className="text-lg text-gold tabular-nums">{r.feeCop === 0 ? "Gratis" : formatCop(r.feeCop)}</p>
              </div>
              <p className="text-xs text-muted">{describeRule(r)}</p>
              <IdempotentActionForm
                action={saveFeeRuleAction}
                hidden={{ ruleId: r.id }}
                fields={feeRuleFields(r)}
                submitLabel="Guardar cambios"
                pendingLabel="Guardando…"
              />
              <IdempotentActionForm
                action={setFeeRuleActiveAction}
                hidden={{ ruleId: r.id, active: String(!r.isActive) }}
                fields={[]}
                submitLabel={r.isActive ? "Desactivar tarifa" : "Activar tarifa"}
                pendingLabel="Guardando…"
              />
            </li>
          ))}
        </ul>
        <div className="card flex flex-col gap-3 p-5">
          <h3 className="font-display text-2xl">Nueva tarifa</h3>
          <IdempotentActionForm
            action={saveFeeRuleAction}
            fields={feeRuleFields(null)}
            submitLabel="Crear tarifa"
            pendingLabel="Creando…"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-3xl">Cambios recientes</h2>
        {config.changes.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay cambios registrados.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {config.changes.map((c) => (
              <li key={`${c.tableName}-${c.rowId}-${c.createdAt}`} className="flex flex-col py-2 text-sm">
                <span>
                  {c.changedBy ?? "Sistema"} {OPERATION_LABELS[c.operation] ?? c.operation}{" "}
                  {(TABLE_LABELS[c.tableName] ?? c.tableName).toLowerCase()}: {describeChange(c)}
                </span>
                <span className="text-xs text-muted">{DATE.format(new Date(c.createdAt))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function describeRule(r: FeeRule): string {
  return [
    CUSTOMER_TYPE_LABELS[r.customerType ?? "any"],
    r.minBoxes ? `desde ${r.minBoxes} cajas` : null,
    r.maxDistanceM ? `hasta ${formatDistance(r.maxDistanceM)}` : "cualquier distancia",
  ]
    .filter(Boolean)
    .join(" · ");
}

function feeRuleFields(r: FeeRule | null): IdempotentField[] {
  return [
    { kind: "text", name: "name", label: "Nombre", maxLength: 80, defaultValue: r?.name },
    {
      kind: "select",
      name: "customerType",
      label: "Clientes",
      options: Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      defaultValue: r ? (r.customerType ?? "any") : undefined,
    },
    {
      kind: "number",
      name: "minBoxes",
      label: "Cajas mínimas (vacío: cualquiera)",
      min: 1,
      max: 10000,
      required: false,
      defaultValue: r?.minBoxes != null ? String(r.minBoxes) : undefined,
    },
    {
      kind: "number",
      name: "maxDistanceM",
      label: "Distancia máxima en metros (vacío: cualquiera)",
      min: 1,
      max: 50000,
      required: false,
      defaultValue: r?.maxDistanceM != null ? String(r.maxDistanceM) : undefined,
    },
    {
      kind: "number",
      name: "feeCop",
      label: "Valor en pesos",
      min: 0,
      max: 1000000,
      defaultValue: r ? String(r.feeCop) : undefined,
    },
  ];
}

function describeChange(c: ConfigChange): string {
  const row = c.newRow ?? c.oldRow ?? {};
  if (c.tableName === "app_settings") return SETTING_LABELS[c.rowId] ?? c.rowId;
  const name = String(row.name ?? row.municipality ?? c.rowId);
  if (c.operation !== "UPDATE" || !c.oldRow || !c.newRow) return name;
  const changed = Object.keys(c.newRow).filter(
    (k) => k !== "updated_at" && JSON.stringify(c.newRow![k]) !== JSON.stringify(c.oldRow![k]),
  );
  if (changed.length === 1 && changed[0] === "is_active") return `${name} (${c.newRow.is_active ? "se activó" : "se desactivó"})`;
  return `${name} (${changed.map((k) => FIELD_LABELS[k] ?? k).join(", ")})`;
}
