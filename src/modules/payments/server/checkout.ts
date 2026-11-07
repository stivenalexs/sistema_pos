import "server-only";

import { createHash } from "node:crypto";

import type { WompiConfig } from "./wompi-config";

// Wompi Web Checkout (D-040). Source:
// https://docs.wompi.co/en/docs/colombia/widget-checkout-web/
// The integrity signature is computed ONLY on the server, so the integrity
// secret never reaches the browser.

/**
 * SHA-256 hex of <reference><amountInCents><currency>[<expirationTime>]<secret>.
 * With expiration-time the date goes before the secret, as in the docs.
 */
export function integritySignature(input: {
  reference: string;
  amountInCents: number;
  currency: "COP";
  expirationTime?: string;
  integritySecret: string;
}): string {
  const text =
    input.reference +
    String(input.amountInCents) +
    input.currency +
    (input.expirationTime ?? "") +
    input.integritySecret;
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type CheckoutInput = {
  reference: string;
  amountInCents: number;
  /** ISO 8601 in UTC: until when the stock stays reserved. */
  expiresAt: string;
  redirectUrl: string;
  customerEmail?: string | null;
  customerFullName?: string | null;
};

/** URL of the Wompi checkout (GET form) with every parameter signed. */
export function buildCheckoutUrl(config: WompiConfig, input: CheckoutInput): string {
  if (!Number.isSafeInteger(input.amountInCents) || input.amountInCents <= 0) {
    throw new Error("amountInCents must be a positive integer.");
  }
  const expirationTime = new Date(input.expiresAt).toISOString();
  const params = new URLSearchParams({
    "public-key": config.publicKey,
    currency: "COP",
    "amount-in-cents": String(input.amountInCents),
    reference: input.reference,
    "signature:integrity": integritySignature({
      reference: input.reference,
      amountInCents: input.amountInCents,
      currency: "COP",
      expirationTime,
      integritySecret: config.integritySecret,
    }),
    "redirect-url": input.redirectUrl,
    "expiration-time": expirationTime,
  });
  if (input.customerEmail) params.set("customer-data:email", input.customerEmail);
  if (input.customerFullName) params.set("customer-data:full-name", input.customerFullName);
  return `${config.checkoutUrl}?${params.toString()}`;
}

/** Converts whole pesos to Wompi cents. The only place where this happens. */
export function copToCents(amountCop: number): number {
  if (!Number.isSafeInteger(amountCop) || amountCop <= 0) {
    throw new Error("amountCop must be a positive integer.");
  }
  return amountCop * 100;
}
