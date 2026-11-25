// The body of POST /api/orders, read without I/O (D-039, D-045, D-067, D-077).
// It says only pickup or delivery, which address and the cédula of whoever
// picks up. Prices and the delivery fee are never read from the request
// (agents.md §5.1): the database computes them.

import { isUuid } from "@/shared/actions/action-types";

/** pickupDocument: cédula of whoever picks the order up (customers without a NIT, D-067). */
export type Fulfillment =
  | { fulfillment: "pickup"; pickupDocument?: string }
  | { fulfillment: "delivery"; addressId: string };

/** Longest cédula text accepted from the browser; the database validates the digits. */
export const MAX_PICKUP_DOCUMENT_LENGTH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The customer's choice, or null if the body is not a valid one. A missing
 * body or fulfillment means pickup. Any other field is ignored.
 */
export function parseOrderRequest(body: unknown): Fulfillment | null {
  const raw = isRecord(body) ? body : {};
  if (raw.fulfillment === undefined || raw.fulfillment === "pickup") {
    const document = raw.pickupDocument;
    return typeof document === "string" && document.length > 0 && document.length <= MAX_PICKUP_DOCUMENT_LENGTH
      ? { fulfillment: "pickup", pickupDocument: document }
      : { fulfillment: "pickup" };
  }
  if (raw.fulfillment === "delivery" && typeof raw.addressId === "string" && isUuid(raw.addressId)) {
    return { fulfillment: "delivery", addressId: raw.addressId };
  }
  return null;
}
