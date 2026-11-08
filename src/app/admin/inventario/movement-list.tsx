import { MOVEMENT_LABELS, type MovementRow } from "@/modules/inventory";

const DATE = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });

// Movements ledger, newest first (read only: the ledger is insert-only).
export function MovementList({ movements, showProduct }: { movements: MovementRow[]; showProduct: boolean }) {
  if (movements.length === 0) return <p className="text-sm text-muted">Todavía no hay movimientos.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line border-y border-line">
      {movements.map((m) => (
        <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
          <div className="flex flex-col">
            <span>
              <span className="font-medium">{MOVEMENT_LABELS[m.type]}</span>
              {showProduct ? <span className="text-muted"> · {m.productName}</span> : null}
            </span>
            <span className="text-xs text-muted">
              {DATE.format(new Date(m.createdAt))}
              {m.recordedBy ? ` · ${m.recordedBy}` : ""}
              {m.reference ? ` · ${m.reference}` : ""}
              {m.reason ? ` · ${m.reason}` : ""}
            </span>
          </div>
          <span className={`tabular-nums ${m.units < 0 ? "text-danger" : "text-success"}`}>
            {m.units > 0 ? "+" : ""}
            {m.units.toLocaleString("es-CO")}
          </span>
        </li>
      ))}
    </ul>
  );
}
