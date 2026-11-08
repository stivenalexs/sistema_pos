// Builds the Factus request for one invoice (D-044). Pure, no I/O.
// Codes from the Factus reference tables (developers.factus.com.co):
//   document 01, operation 10, unit 94, standard 999, tax 01 (IVA),
//   payment form 1 (cash), methods 10/47/48/49/ZZZ,
//   identification 13 (cédula) / 31 (NIT), legal organization 1 / 2.

export type InvoiceLineData = {
  sku: string;
  name: string;
  quantity_units: number;
  /** base + participation + exploitation: the line before IVA. */
  net_cop: number;
  iva_cop: number;
  final_cop: number;
};

export type InvoiceBuyer =
  | { kind: "company"; nit: string; company: string; email: string | null; phone: string | null }
  | { kind: "final_consumer"; names: string; email: string | null };

export type InvoiceData = {
  reference_code: string;
  payment_method_code: string;
  total_cop: number;
  customer: InvoiceBuyer;
  lines: InvoiceLineData[];
};

// PROJECT ASSUMPTION (D-044): identification used for "consumidor final".
export const FINAL_CONSUMER_ID = "222222222222";

const WOMPI_TO_FACTUS_METHOD: Record<string, string> = {
  CARD: "48",
  PSE: "47",
  NEQUI: "47",
  BANCOLOMBIA_TRANSFER: "47",
  BANCOLOMBIA_QR: "47",
  DAVIPLATA: "47",
  // POS sales (D-053): cash, card terminal and bank transfer.
  POS_CASH: "10",
  POS_CARD: "48",
  POS_TRANSFER: "47",
};

export function paymentMethodCode(wompiMethod: string): string {
  return WOMPI_TO_FACTUS_METHOD[wompiMethod] ?? "ZZZ";
}

function money(value: number): string {
  return value.toFixed(2);
}

/**
 * NIT stored without separator (e.g. "9001234567"): Colombian NITs have 9
 * digits plus a check digit. PROJECT ASSUMPTION: 10 or more digits means the
 * last one is the check digit; Factus computes the dv when omitted.
 */
export function splitNit(nit: string): { identification: string; dv: string | null } {
  const digits = nit.replace(/\D/g, "");
  if (digits.length >= 10) {
    return { identification: digits.slice(0, -1), dv: digits.slice(-1) };
  }
  return { identification: digits, dv: null };
}

export function buildBillPayload(invoice: InvoiceData, ivaRatePct: number, numberingRangeId: number | null) {
  const items = invoice.lines.map((line) => {
    // Unit price before IVA, two decimals as Factus requires.
    const unitNet = Math.round((line.net_cop / line.quantity_units) * 100) / 100;
    return {
      code_reference: line.sku,
      name: line.name.slice(0, 150),
      quantity: money(line.quantity_units),
      discount_rate: "0.00",
      price: money(unitNet),
      unit_measure_code: "94",
      standard_code: "999",
      taxes: [{ code: "01", rate: money(ivaRatePct) }],
    };
  });

  // What Factus will total from our lines, to reconcile with what was charged.
  const factusTotal = invoice.lines.reduce((sum, line) => {
    const unitNet = Math.round((line.net_cop / line.quantity_units) * 100) / 100;
    const net = Math.round(unitNet * line.quantity_units * 100) / 100;
    const iva = Math.round(net * ivaRatePct) / 100;
    return sum + net + iva;
  }, 0);
  const rounding = Math.round((invoice.total_cop - factusTotal) * 100) / 100;
  if (Math.abs(rounding) > 500) {
    throw new Error("invoice_rounding_out_of_range");
  }

  const buyer = invoice.customer;
  const customer =
    buyer.kind === "company"
      ? {
          identification_document_code: "31",
          ...(() => {
            const { identification, dv } = splitNit(buyer.nit);
            return dv ? { identification, dv } : { identification };
          })(),
          legal_organization_code: "1",
          company: buyer.company,
          tribute_code: "ZZ",
          ...(buyer.email ? { email: buyer.email } : {}),
          ...(buyer.phone ? { phone: buyer.phone } : {}),
        }
      : {
          identification_document_code: "13",
          identification: FINAL_CONSUMER_ID,
          legal_organization_code: "2",
          names: buyer.names,
          tribute_code: "ZZ",
          ...(buyer.email ? { email: buyer.email } : {}),
        };

  return {
    reference_code: invoice.reference_code,
    document: "01",
    operation_type: "10",
    ...(numberingRangeId !== null ? { numbering_range_id: numberingRangeId } : {}),
    observation: "Venta de licores. Precios con impuesto al consumo / participación incluido.".slice(0, 250),
    payment_details: [
      {
        payment_form: "1",
        payment_method_code: paymentMethodCode(invoice.payment_method_code),
        amount: money(invoice.total_cop),
      },
    ],
    cash_rounding_amount: money(rounding),
    customer,
    items,
  };
}
