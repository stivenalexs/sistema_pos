import { describe, expect, it, vi } from "vitest";

import { PermanentActionError } from "@/shared/actions/server/worker";

import { buildBillPayload, FINAL_CONSUMER_ID, paymentMethodCode, splitNit } from "./domain/build-bill";
import { FactusClient, FactusTransientError, parseFactusConfig } from "./server/factus-client";
import { issueCreditNote, issueInvoice } from "./server/issue-invoice";

const CONFIG = parseFactusConfig({
  FACTUS_ENV: "sandbox",
  FACTUS_CLIENT_ID: "id",
  FACTUS_CLIENT_SECRET: "secret",
  FACTUS_USERNAME: "user@test.co",
  FACTUS_PASSWORD: "pw",
});

// Whisky importado from the tax guide: final $108.465 = net $103.300 + IVA $5.165.
const INVOICE = {
  reference_code: "INV-ABC",
  payment_method_code: "CARD",
  total_cop: 108465,
  customer: { kind: "final_consumer" as const, names: "Consumidor final", email: "a@b.co" },
  lines: [{ sku: "IMP-WHI", name: "Whisky", quantity_units: 1, net_cop: 103300, iva_cop: 5165, final_cop: 108465 }],
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("buildBillPayload", () => {
  it("sends the price before IVA and only IVA as tax (no Factus code for ICL)", () => {
    const bill = buildBillPayload(INVOICE, 5, null);
    expect(bill.items[0]).toMatchObject({
      price: "103300.00",
      quantity: "1.00",
      unit_measure_code: "94",
      standard_code: "999",
      taxes: [{ code: "01", rate: "5.00" }],
    });
    expect(bill.payment_details[0]).toEqual({ payment_form: "1", payment_method_code: "48", amount: "108465.00" });
    expect(bill.cash_rounding_amount).toBe("0.00");
    expect(bill).not.toHaveProperty("numbering_range_id");
  });

  it("invoices retail customers as final consumer (assumption)", () => {
    const bill = buildBillPayload(INVOICE, 5, 389);
    expect(bill.customer).toMatchObject({
      identification_document_code: "13",
      identification: FINAL_CONSUMER_ID,
      legal_organization_code: "2",
      names: "Consumidor final",
    });
    expect(bill.numbering_range_id).toBe(389);
  });

  it("invoices wholesale customers with NIT, company and the check digit apart", () => {
    const bill = buildBillPayload(
      { ...INVOICE, customer: { kind: "company", nit: "9001234567", company: "Licores W SAS", email: null, phone: null } },
      5,
      null,
    );
    expect(bill.customer).toMatchObject({
      identification_document_code: "31",
      identification: "900123456",
      dv: "7",
      legal_organization_code: "1",
      company: "Licores W SAS",
    });
  });

  it("reconciles rounding with cash_rounding_amount when units do not divide evenly", () => {
    const bill = buildBillPayload(
      { ...INVOICE, total_cop: 100000, lines: [{ sku: "X", name: "X", quantity_units: 3, net_cop: 95238, iva_cop: 4762, final_cop: 100000 }] },
      5,
      null,
    );
    expect(bill.items[0]?.price).toBe("31746.00");
    expect(Math.abs(Number(bill.cash_rounding_amount))).toBeLessThanOrEqual(500);
  });

  it("adds the delivery fee as its own line with IVA (D-045) and the total still matches", () => {
    // 6.000 delivery = 5.714 before IVA + 286 IVA.
    const bill = buildBillPayload(
      {
        ...INVOICE,
        total_cop: 108465 + 6000,
        lines: [
          ...INVOICE.lines,
          { sku: "DOMICILIO", name: "Servicio de domicilio", quantity_units: 1, net_cop: 5714, iva_cop: 286, final_cop: 6000 },
        ],
      },
      5,
      null,
    );
    expect(bill.items[1]).toMatchObject({ code_reference: "DOMICILIO", price: "5714.00", taxes: [{ code: "01", rate: "5.00" }] });
    expect(bill.payment_details[0]?.amount).toBe("114465.00");
    expect(Math.abs(Number(bill.cash_rounding_amount))).toBeLessThan(1);
  });

  it("maps Wompi methods to Factus codes", () => {
    expect(paymentMethodCode("CARD")).toBe("48");
    expect(paymentMethodCode("PSE")).toBe("47");
    expect(paymentMethodCode("SOMETHING_NEW")).toBe("ZZZ");
    expect(paymentMethodCode("POS_CASH")).toBe("10");
    expect(paymentMethodCode("POS_CARD")).toBe("48");
    expect(paymentMethodCode("POS_TRANSFER")).toBe("47");
    expect(splitNit("900123456")).toEqual({ identification: "900123456", dv: null });
  });
});

describe("FactusClient", () => {
  it("logs in once and reuses the token", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/oauth/token")
        ? json(200, { access_token: "t1", refresh_token: "r1", expires_in: 3600 })
        : json(201, { data: { is_validated: true } }),
    );
    const client = new FactusClient(CONFIG, fetchMock);
    await client.post("/v2/bills/validate", {});
    await client.post("/v2/bills/validate", {});
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/oauth/token"))).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api-sandbox.factus.com.co/oauth/token");
  });

  it("renews the token and retries once after a 401", async () => {
    let tokens = 0;
    let calls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        tokens += 1;
        return json(200, { access_token: `t${tokens}`, refresh_token: "r", expires_in: 3600 });
      }
      calls += 1;
      return calls === 1 ? json(401, { message: "Unauthenticated." }) : json(201, { data: { is_validated: true } });
    });
    const response = await new FactusClient(CONFIG, fetchMock).post("/v2/bills/validate", {});
    expect(response.status).toBe(201);
    expect(tokens).toBe(2);
  });

  it("renews an expired token with the refresh token", async () => {
    let now = 0;
    const grants: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/oauth/token")) {
        grants.push(new URLSearchParams(String(init.body)).get("grant_type") ?? "");
        return json(200, { access_token: "t", refresh_token: "r", expires_in: 600 });
      }
      return json(201, { data: { is_validated: true } });
    });
    const client = new FactusClient(CONFIG, fetchMock, () => now);
    await client.post("/v2/bills/validate", {});
    now += 601_000;
    await client.post("/v2/bills/validate", {});
    expect(grants).toEqual(["password", "refresh_token"]);
  });

  it("treats 5xx and network errors as transient", async () => {
    const token = json(200, { access_token: "t", expires_in: 3600 });
    const fiveHundred = new FactusClient(CONFIG, vi.fn(async (url: string) => (url.endsWith("/oauth/token") ? token.clone() : json(503, {}))));
    await expect(fiveHundred.post("/v2/bills/validate", {})).rejects.toBeInstanceOf(FactusTransientError);
  });
});

describe("issueInvoice (worker)", () => {
  function fakeDb(invoice: Record<string, unknown>) {
    const results: { outcome: string; error?: string }[] = [];
    const db = {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === "prepare_invoice") return { data: invoice, error: null };
        results.push({ outcome: String(args.p_outcome), error: args.p_error as string | undefined });
        return { data: null, error: null };
      }),
    };
    return { db: db as never, results };
  }

  function fakeClient(status: number, body: unknown) {
    return { post: vi.fn(async () => ({ status, body })) } as unknown as FactusClient;
  }

  const PREPARED = { ...INVOICE, id: "inv-1", status: "pending" };

  it("marks the invoice accepted when the DIAN validates it", async () => {
    const { db, results } = fakeDb(PREPARED);
    const client = fakeClient(201, { data: { is_validated: true, number: "SETP1", cufe: "c" } });
    await expect(issueInvoice("o-1", { db, client, numberingRangeId: null })).resolves.toMatchObject({ outcome: "accepted" });
    expect(results).toEqual([{ outcome: "accepted", error: undefined }]);
  });

  function notInvoiceableDb(order: { voided_at: string | null; needs_refund: boolean } | null) {
    return {
      rpc: vi.fn(async () => ({ data: null, error: { message: "invoice_order_not_invoiceable" } })),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order, error: null }) }) }) }),
    } as never;
  }

  it("ends without an alert when the POS sale was voided or the order is to refund (D-057)", async () => {
    const client = fakeClient(201, {});
    for (const order of [
      { voided_at: "2026-11-08T15:00:00Z", needs_refund: false },
      { voided_at: null, needs_refund: true },
    ]) {
      await expect(
        issueInvoice("o-1", { db: notInvoiceableDb(order), client, numberingRangeId: null }),
      ).resolves.toMatchObject({ outcome: "skipped_not_invoiceable" });
    }
    expect(client.post).not.toHaveBeenCalled();
  });

  it("still fails for good when an order is not invoiceable for another reason", async () => {
    const db = notInvoiceableDb({ voided_at: null, needs_refund: false });
    await expect(issueInvoice("o-1", { db, client: fakeClient(201, {}), numberingRangeId: null })).rejects.toBeInstanceOf(
      PermanentActionError,
    );
  });

  it("does nothing when the worker runs twice for an accepted invoice", async () => {
    const { db } = fakeDb({ ...PREPARED, status: "accepted" });
    const client = fakeClient(201, {});
    await expect(issueInvoice("o-1", { db, client, numberingRangeId: null })).resolves.toMatchObject({
      outcome: "already_accepted",
    });
    expect(client.post).not.toHaveBeenCalled();
  });

  it("does not retry a rejection (e.g. numbering range problem): admin inbox", async () => {
    const { db, results } = fakeDb(PREPARED);
    const client = fakeClient(422, { message: "El rango de numeración no está vigente" });
    await expect(issueInvoice("o-1", { db, client, numberingRangeId: null })).rejects.toBeInstanceOf(PermanentActionError);
    expect(results[0]).toEqual({ outcome: "rejected", error: "422: El rango de numeración no está vigente" });
  });

  it("keeps an invoice pending at Factus (409) for the admin instead of deleting it", async () => {
    const { db, results } = fakeDb(PREPARED);
    const client = fakeClient(409, { message: "Se encontró una factura pendiente por enviar a la DIAN" });
    await expect(issueInvoice("o-1", { db, client, numberingRangeId: null })).rejects.toBeInstanceOf(PermanentActionError);
    expect(results[0]?.outcome).toBe("sent");
  });

  it("retries later when Factus registered it but the DIAN has not validated it", async () => {
    const { db } = fakeDb(PREPARED);
    const client = fakeClient(201, { data: { is_validated: false } });
    const error = await issueInvoice("o-1", { db, client, numberingRangeId: null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentActionError);
  });
});

describe("issueCreditNote (worker, D-066)", () => {
  function noteDb(
    invoice: { lines: object[] } & Omit<typeof INVOICE, "lines"> = INVOICE,
    extra: { kind?: string; concept_code?: string } = {},
  ) {
    const note = {
      id: "cn-1",
      reference_code: "NC-1",
      reason: "Anulación de la venta",
      status: "pending",
      kind: "full",
      concept_code: "2",
      ...extra,
      invoices: { ...invoice, factus_number: "SETP990000001", invoice_lines: invoice.lines },
    };
    return {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: note, error: null }) }) }) }),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    } as never;
  }

  it("sends the invoice's customer with its fiscal responsibilities and the credit note range", async () => {
    const post = vi.fn(async () => ({ status: 201, body: { data: { is_validated: true, credit_note: { number: "NC1" } } } }));
    await issueCreditNote("cn-1", { db: noteDb(), client: { post } as unknown as FactusClient, creditNoteRangeId: 390 });
    const [path, payload] = post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(path).toBe("/v2/credit-notes/validate");
    expect(payload).toMatchObject({
      bill_number: "SETP990000001",
      correction_concept_code: "2",
      customization_id: "20",
      numbering_range_id: 390,
      customer: { identification: FINAL_CONSUMER_ID, responsibilities: ["R-99-PN"] },
    });
  });

  it("omits the range when there is a single active credit note range", async () => {
    const post = vi.fn(async () => ({ status: 201, body: { data: { is_validated: true } } }));
    await issueCreditNote("cn-1", { db: noteDb(), client: { post } as unknown as FactusClient, creditNoteRangeId: null });
    expect((post.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).not.toHaveProperty("numbering_range_id");
  });

  it("pays the total Factus computes from the items, since credit notes have no cash rounding", async () => {
    // Real sandbox case: 52.000 charged, Factus totals 49.524 + 2.476,20 = 52.000,20.
    const invoice = {
      ...INVOICE,
      payment_method_code: "POS_CARD",
      total_cop: 52000,
      lines: [{ sku: "NAC-RON-750", name: "Ron", quantity_units: 1, net_cop: 49524, iva_cop: 2476, final_cop: 52000 }],
    };
    const post = vi.fn(async () => ({ status: 201, body: { data: { is_validated: true } } }));
    await issueCreditNote("cn-1", { db: noteDb(invoice), client: { post } as unknown as FactusClient, creditNoteRangeId: 390 });
    const payload = (post.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(payload).not.toHaveProperty("cash_rounding_amount");
    expect(payload.payment_details).toEqual([expect.objectContaining({ amount: "52000.20" })]);
  });

  it("credits only the product lines with concept 1 for a products-only refund (D-069)", async () => {
    const invoice = {
      ...INVOICE,
      total_cop: 114465,
      lines: [
        { ...INVOICE.lines[0]!, line_kind: "product" },
        { sku: "DOMICILIO", name: "Servicio de domicilio", quantity_units: 1, net_cop: 5714, iva_cop: 286, final_cop: 6000, line_kind: "delivery" },
      ],
    };
    const post = vi.fn(async () => ({ status: 201, body: { data: { is_validated: true } } }));
    await issueCreditNote("cn-1", {
      db: noteDb(invoice, { kind: "products_only", concept_code: "1" }),
      client: { post } as unknown as FactusClient,
      creditNoteRangeId: 390,
    });
    const payload = (post.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(payload.correction_concept_code).toBe("1");
    const items = payload.items as { code_reference: string }[];
    expect(items.map((i) => i.code_reference)).toEqual(["IMP-WHI"]);
    // 103.300 + 5 % IVA = 108.465: the products only, without the delivery.
    expect(payload.payment_details).toEqual([expect.objectContaining({ amount: "108465.00" })]);
  });
});
