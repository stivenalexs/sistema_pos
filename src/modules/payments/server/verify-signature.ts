import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

// ============================================================================
// PROTECTED FILE (agents.md §6): verification of Wompi event signatures.
// Do not change without human review.
// Reviewed by the project owner on 2026-11-07; fixes applied and the
// corrected version approved the same day (D-040).
// ============================================================================
//
// Real event body sent by Wompi
// (https://docs.wompi.co/en/docs/colombia/eventos/):
//   {
//     "event": "transaction.updated",
//     "data": { "transaction": { ... } },
//     "environment": "prod",
//     "signature": { "properties": ["transaction.id", ...], "checksum": "..." },
//     "timestamp": 1530291411,          <- at the ROOT, not inside signature
//     "sent_at": "2018-07-20T16:45:05.000Z"
//   }
//
// Algorithm:
//   1. Take the values of the fields listed in signature.properties, IN THAT
//      ORDER, from the event's `data` object (e.g. "transaction.id").
//   2. Concatenate them with no separator.
//   3. Append the timestamp (integer UNIX timestamp).
//   4. Append the events secret (test_events_... / prod_events_...).
//   5. SHA-256 of the result.
//   6. Compare with signature.checksum (also sent as X-Event-Checksum).
// The properties list can change over time, so it is always read from the
// event, never hardcoded.

const MAX_PROPERTIES = 32;
const MAX_PROPERTY_LENGTH = 128;
const PROPERTY_PATH = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/;
const HEX_SHA256 = /^[0-9a-fA-F]{64}$/;

export type SignatureCheck =
  | { valid: true; checksum: string }
  | {
      valid: false;
      reason:
        | "missing_secret"
        | "missing_signature"
        | "invalid_timestamp"
        | "missing_property"
        | "header_mismatch"
        | "checksum_mismatch";
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Walks only plain JSON objects; arrays and inherited keys are never followed.
function readPath(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const key of path.split(".")) {
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function isValidProperties(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_PROPERTIES &&
    value.every(
      (p) => typeof p === "string" && p.length <= MAX_PROPERTY_LENGTH && PROPERTY_PATH.test(p),
    )
  );
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isValidSecret(secret: unknown): secret is string {
  return typeof secret === "string" && secret.trim().length > 0;
}

/**
 * SHA-256 hex (uppercase) of the concatenated properties + timestamp + secret.
 * Returns null when a property is missing or is not a scalar, or when the
 * secret is empty (fails closed).
 */
export function computeEventChecksum(
  data: unknown,
  properties: string[],
  timestamp: number,
  eventsSecret: string,
): string | null {
  if (!isValidSecret(eventsSecret)) return null;
  let concatenated = "";
  for (const property of properties) {
    const value = readPath(data, property);
    if (value === undefined || value === null || typeof value === "object") return null;
    concatenated += String(value);
  }
  concatenated += String(timestamp) + eventsSecret;
  return createHash("sha256").update(concatenated, "utf8").digest("hex").toUpperCase();
}

/**
 * Verifies a Wompi event. `checksumHeader` is the X-Event-Checksum header: it
 * is optional, but if present it must match the body's checksum. It adds no
 * security by itself (anyone can copy the body's checksum into it); the
 * protection is the secret (D-040).
 */
export function verifyWompiEvent(
  event: unknown,
  checksumHeader: string | null,
  eventsSecret: string,
): SignatureCheck {
  if (!isValidSecret(eventsSecret)) {
    return { valid: false, reason: "missing_secret" };
  }
  if (!isPlainObject(event) || !isPlainObject(event.signature)) {
    return { valid: false, reason: "missing_signature" };
  }

  const signature = event.signature;
  if (
    !isValidProperties(signature.properties) ||
    typeof signature.checksum !== "string" ||
    !HEX_SHA256.test(signature.checksum)
  ) {
    return { valid: false, reason: "missing_signature" };
  }

  // Real events carry the timestamp at the root. A timestamp inside
  // signature is also accepted, but if both are present they must match.
  const rootTimestamp = event.timestamp;
  const signatureTimestamp = signature.timestamp;
  if (rootTimestamp !== undefined && signatureTimestamp !== undefined && rootTimestamp !== signatureTimestamp) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  const timestamp = rootTimestamp ?? signatureTimestamp;
  if (!isValidTimestamp(timestamp)) {
    return { valid: false, reason: "invalid_timestamp" };
  }

  const received = signature.checksum.toUpperCase();
  if (checksumHeader !== null && checksumHeader.trim().toUpperCase() !== received) {
    return { valid: false, reason: "header_mismatch" };
  }

  const expected = computeEventChecksum(event.data, signature.properties, timestamp, eventsSecret);
  if (expected === null) {
    return { valid: false, reason: "missing_property" };
  }

  // Compare the 32 raw bytes of the digest, in constant time.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== 32 || b.length !== 32 || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "checksum_mismatch" };
  }
  return { valid: true, checksum: received };
}
