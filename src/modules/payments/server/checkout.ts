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
  /** Omitted when null: Wompi then shows its own result page. */
  redirectUrl: string | null;
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
    "expiration-time": expirationTime,
  });
  if (input.redirectUrl) params.set("redirect-url", input.redirectUrl);
  if (input.customerEmail) params.set("customer-data:email", input.customerEmail);
  if (input.customerFullName) params.set("customer-data:full-name", input.customerFullName);
  return `${config.checkoutUrl}?${params.toString()}`;
}

/**
 * Return URL for the checkout, or null when the site runs on localhost:
 * Wompi's CDN answers 403 "Request blocked" to any checkout whose
 * redirect-url points to localhost or 127.0.0.1 (checked 2026-11-07, D-040).
 * In local development, open the app as http://lvh.me:3000 to get the
 * redirect back (lvh.me resolves to 127.0.0.1).
 */
export function checkoutRedirectUrl(siteOrigin: string, orderId: string): string | null {
  const host = new URL(siteOrigin).hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return null;
  }
  return `${siteOrigin}/orders/${orderId}/payment-return`;
}

/** Converts whole pesos to Wompi cents. The only place where this happens. */
export function copToCents(amountCop: number): number {
  if (!Number.isSafeInteger(amountCop) || amountCop <= 0) {
    throw new Error("amountCop must be a positive integer.");
  }
  return amountCop * 100;
}
