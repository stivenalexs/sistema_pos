import { describe, expect, it } from "vitest";

import { adminTasks, sectionCounts, type SummaryCounts } from "./admin-tasks";

const ZERO: SummaryCounts = {
  pendingWholesale: 0,
  pendingInvitations: 0,
  invoicesAttention: 0,
  failedActions: 0,
  queueStuck: 0,
  refundsPending: 0,
  lowStock: 0,
  stockMismatches: 0,
  deliveriesToAssign: 0,
  deliveriesFailed: 0,
};

describe("adminTasks", () => {
  it("has nothing pending when everything is at zero", () => {
    const { pending, upToDate } = adminTasks(ZERO);
    expect(pending).toEqual([]);
    expect(upToDate).toContain("domicilios");
  });

  it("orders by urgency and writes singular and plural", () => {
    const { pending, upToDate } = adminTasks({
      ...ZERO,
      deliveriesToAssign: 2,
      invoicesAttention: 1,
      pendingWholesale: 1,
    });
    expect(pending.map((task) => task.text)).toEqual([
      "1 factura o nota crédito sin aceptar",
      "2 domicilios esperan mensajero",
      "1 mayorista por revisar",
    ]);
    expect(pending[1]?.label).toBe("domicilios esperan mensajero");
    expect(pending[1]?.action).toBe("Asignar");
    expect(upToDate).not.toContain("facturas");
    expect(upToDate).toContain("reembolsos");
  });

  it("puts integrity problems first", () => {
    const { pending } = adminTasks({ ...ZERO, lowStock: 3, stockMismatches: 1 });
    expect(pending[0]?.key).toBe("stockMismatches");
    expect(pending[0]?.urgent).toBe(true);
  });
});

describe("sectionCounts", () => {
  it("adds the pending items of each menu section", () => {
    const counts = sectionCounts({ ...ZERO, deliveriesToAssign: 2, deliveriesFailed: 1, failedActions: 1, queueStuck: 2 });
    expect(counts["/admin/domicilios"]).toBe(3);
    expect(counts["/admin/cola"]).toBe(3);
    expect(counts["/admin/facturas"]).toBe(0);
  });
});
