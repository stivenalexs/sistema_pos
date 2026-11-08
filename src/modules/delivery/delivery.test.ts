import { describe, expect, it, vi } from "vitest";

import {
  formatDistance,
  isValidSignaturePng,
  MAX_SIGNATURE_BYTES,
  parseAddressInput,
  parseProofInput,
  signaturePath,
} from "./domain/delivery";
import { processDeliveryAttempt } from "./server/courier";
import { PermanentActionError } from "@/shared/actions/server/worker";

const ZONE = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const KEY = "33333333-3333-4333-8333-333333333333";
const COURIER = "44444444-4444-4444-8444-444444444444";

describe("parseAddressInput", () => {
  const valid = { label: " Casa ", addressLine: "Cra 43A # 1-50", details: "", zoneId: ZONE, lat: "6.25", lng: "-75.57" };

  it("accepts a complete address and trims it", () => {
    expect(parseAddressInput(valid)).toEqual({
      ok: true,
      value: { label: "Casa", addressLine: "Cra 43A # 1-50", details: null, zoneId: ZONE, lat: 6.25, lng: -75.57 },
    });
  });

  it("requires the point on the map", () => {
    const result = parseAddressInput({ ...valid, lat: "", lng: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.lat).toBeDefined();
  });

  it("rejects coordinates out of range or not numeric", () => {
    expect(parseAddressInput({ ...valid, lat: "120" }).ok).toBe(false);
    expect(parseAddressInput({ ...valid, lng: "abc" }).ok).toBe(false);
    expect(parseAddressInput({ ...valid, lat: "1e3" }).ok).toBe(false);
  });

  it("requires a municipality and a real address", () => {
    const result = parseAddressInput({ ...valid, zoneId: "medellin", addressLine: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.zoneId).toBeDefined();
      expect(result.errors.addressLine).toBeDefined();
    }
  });
});

describe("parseProofInput", () => {
  const delivered = {
    outcome: "delivered",
    recipientName: "Ana Pérez",
    documentNumber: "1.020.304.050",
    ageConfirmed: "true",
    failureReason: null,
    notes: "",
  };

  it("accepts a delivery with name, cédula and age, and strips the dots", () => {
    expect(parseProofInput(delivered)).toEqual({
      ok: true,
      value: { outcome: "delivered", recipientName: "Ana Pérez", documentNumber: "1020304050", ageConfirmed: true, notes: null },
    });
  });

  it("does not deliver without confirming legal age", () => {
    expect(parseProofInput({ ...delivered, ageConfirmed: false })).toEqual({ ok: false, error: "age_not_confirmed" });
  });

  it("rejects a cédula with letters or too short", () => {
    expect(parseProofInput({ ...delivered, documentNumber: "12ab" })).toEqual({ ok: false, error: "invalid_document_number" });
    expect(parseProofInput({ ...delivered, documentNumber: "1234" })).toEqual({ ok: false, error: "invalid_document_number" });
  });

  it("requires the recipient's name", () => {
    expect(parseProofInput({ ...delivered, recipientName: " " })).toEqual({ ok: false, error: "invalid_recipient_name" });
  });

  it("records a failed attempt only with a known reason", () => {
    expect(parseProofInput({ ...delivered, outcome: "failed", failureReason: "recipient_underage" })).toEqual({
      ok: true,
      value: { outcome: "failed", failureReason: "recipient_underage", notes: null },
    });
    expect(parseProofInput({ ...delivered, outcome: "failed", failureReason: "whatever" })).toEqual({
      ok: false,
      error: "invalid_failure_reason",
    });
  });
});

describe("signature", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it("accepts a small PNG", () => {
    expect(isValidSignaturePng(png)).toBe(true);
  });

  it("rejects other formats, empty files and files over 200 KB", () => {
    expect(isValidSignaturePng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(isValidSignaturePng(png.slice(0, 8))).toBe(false);
    const big = new Uint8Array(MAX_SIGNATURE_BYTES + 1);
    big.set(png);
    expect(isValidSignaturePng(big)).toBe(false);
  });

  it("names the object after the order and the intent", () => {
    expect(signaturePath(ORDER, KEY)).toBe(`${ORDER}/${KEY}.png`);
  });
});

describe("formatDistance", () => {
  it("shows meters below 1 km and kilometers above", () => {
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(3200)).toBe("3,2 km");
  });
});

describe("processDeliveryAttempt (worker)", () => {
  const payload = {
    order_id: ORDER,
    attempt_key: KEY,
    outcome: "delivered",
    recipient_name: "Ana Pérez",
    document_number: "1020304050",
    age_confirmed: true,
    failure_reason: null,
    notes: null,
    signature_path: `${ORDER}/${KEY}.png`,
  };

  it("records the attempt with the intent's key and the verified actor", async () => {
    const record = vi.fn().mockResolvedValue({ data: { ok: true, outcome: "delivered", attempt_id: "a1" }, error: null });
    await expect(processDeliveryAttempt(COURIER, payload, record)).resolves.toEqual({ outcome: "delivered", attempt_id: "a1" });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ p_idempotency_key: KEY, p_order_id: ORDER, p_actor_id: COURIER, p_outcome: "delivered" }),
    );
  });

  it("running twice is harmless: the database answers the same attempt", async () => {
    const record = vi
      .fn()
      .mockResolvedValueOnce({ data: { ok: true, outcome: "delivered", attempt_id: "a1" }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, duplicate: true, outcome: "delivered", attempt_id: "a1" }, error: null });
    const first = await processDeliveryAttempt(COURIER, payload, record);
    const second = await processDeliveryAttempt(COURIER, payload, record);
    expect(second).toEqual(first);
  });

  it("a rule rejected by the database fails for good (no blind retries)", async () => {
    const record = vi.fn().mockResolvedValue({ data: { ok: false, error: "signature_missing" }, error: null });
    await expect(processDeliveryAttempt(COURIER, payload, record)).rejects.toBeInstanceOf(PermanentActionError);
  });

  it("a database outage is retried", async () => {
    const record = vi.fn().mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const error = await processDeliveryAttempt(COURIER, payload, record).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentActionError);
  });

  it("an invalid payload or a missing actor fails for good", async () => {
    const record = vi.fn();
    await expect(processDeliveryAttempt(null, payload, record)).rejects.toBeInstanceOf(PermanentActionError);
    await expect(processDeliveryAttempt(COURIER, { order_id: ORDER }, record)).rejects.toBeInstanceOf(PermanentActionError);
    expect(record).not.toHaveBeenCalled();
  });
});
