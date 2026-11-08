// Panel tray and menu counts (D-064). Pure presentation of admin_summary:
// what needs attention first, in plain words, and what is already up to date.

export type SummaryCounts = {
  pendingWholesale: number;
  pendingInvitations: number;
  invoicesAttention: number;
  failedActions: number;
  queueStuck: number;
  refundsPending: number;
  lowStock: number;
  stockMismatches: number;
  deliveriesToAssign: number;
  deliveriesFailed: number;
};

export type Task = {
  key: keyof SummaryCounts;
  count: number;
  /** Sentence for the tray, e.g. "2 domicilios esperan mensajero". */
  text: string;
  /** The same sentence without the number, shown next to it. */
  label: string;
  /** What the link does, e.g. "Asignar". */
  action: string;
  href: string;
  /** Short name for the "Al día" line. */
  short: string;
  urgent: boolean;
};

type Definition = Omit<Task, "count" | "text" | "label"> & { one: string; many: string };

// Ordered by urgency: money and data integrity first, then customers waiting.
const DEFINITIONS: Definition[] = [
  { key: "stockMismatches", one: "producto con el saldo descuadrado", many: "productos con el saldo descuadrado", action: "Revisar", href: "/admin/inventario", short: "saldos de inventario", urgent: true },
  { key: "queueStuck", one: "trabajo detenido en la cola", many: "trabajos detenidos en la cola", action: "Revisar", href: "/admin/cola", short: "cola", urgent: true },
  { key: "invoicesAttention", one: "factura o nota crédito sin aceptar", many: "facturas o notas crédito sin aceptar", action: "Revisar", href: "/admin/facturas", short: "facturas", urgent: true },
  { key: "failedActions", one: "trabajo fallido", many: "trabajos fallidos", action: "Reintentar", href: "/admin/cola", short: "trabajos", urgent: true },
  { key: "refundsPending", one: "reembolso por registrar", many: "reembolsos por registrar", action: "Registrar", href: "/admin/reembolsos", short: "reembolsos", urgent: true },
  { key: "deliveriesFailed", one: "entrega con intento fallido", many: "entregas con intento fallido", action: "Reasignar", href: "/admin/domicilios", short: "entregas", urgent: false },
  { key: "deliveriesToAssign", one: "domicilio espera mensajero", many: "domicilios esperan mensajero", action: "Asignar", href: "/admin/domicilios", short: "domicilios", urgent: false },
  { key: "pendingWholesale", one: "mayorista por revisar", many: "mayoristas por revisar", action: "Revisar", href: "/admin/mayoristas", short: "mayoristas", urgent: false },
  { key: "lowStock", one: "producto en stock bajo", many: "productos en stock bajo", action: "Ver", href: "/admin/inventario", short: "stock", urgent: false },
  { key: "pendingInvitations", one: "invitación sin aceptar", many: "invitaciones sin aceptar", action: "Ver", href: "/admin/personal", short: "invitaciones", urgent: false },
];

export function adminTasks(counts: SummaryCounts): { pending: Task[]; upToDate: string[] } {
  const pending: Task[] = [];
  const upToDate: string[] = [];
  for (const { one, many, ...definition } of DEFINITIONS) {
    const count = counts[definition.key];
    if (count > 0) {
      const label = count === 1 ? one : many;
      pending.push({ ...definition, count, label, text: `${count} ${label}` });
    } else if (!upToDate.includes(definition.short)) {
      upToDate.push(definition.short);
    }
  }
  return { pending, upToDate };
}

/** Pending items per menu section (href → count). */
export function sectionCounts(counts: SummaryCounts): Record<string, number> {
  return {
    "/admin/domicilios": counts.deliveriesToAssign + counts.deliveriesFailed,
    "/admin/facturas": counts.invoicesAttention,
    "/admin/reembolsos": counts.refundsPending,
    "/admin/cola": counts.failedActions + counts.queueStuck,
    "/admin/mayoristas": counts.pendingWholesale,
    "/admin/personal": counts.pendingInvitations,
    "/admin/inventario": counts.lowStock + counts.stockMismatches,
  };
}
