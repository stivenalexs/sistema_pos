import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildCheckoutUrl, checkoutRedirectUrl, copToCents, integritySignature } from "./checkout";
import { computeEventChecksum, verifyWompiEvent } from "./verify-signature";
import { parseWompiConfig } from "./wompi-config";

const SECRET = "test_events_EXAMPLE";

function sha(text: string) {
  return createHash("sha256").update(text).digest("hex").toUpperCase();
}

// Built in the REAL shape Wompi sends: timestamp at the root, and signature
// with only properties and checksum (owner review of D-040, finding 1).
function signedEvent(overrides: { status?: string; secret?: string } = {}) {
  const data = {
    transaction: {
      id: "1234-1610641025-49201",
      status: overrides.status ?? "APPROVED",
      amount_in_cents: 4490000,
      reference: "REF-1",
      currency: "COP",
    },
  };
  const timestamp = 1530291411;
  const properties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
  // As in the docs' example: values in order + timestamp + secret.
  const checksum = sha(`1234-1610641025-49201APPROVED4490000${timestamp}${overrides.secret ?? SECRET}`);
  return {
    event: "transaction.updated",
    data,
    environment: "test",
    signature: { properties, checksum } as { properties: string[]; checksum: string; timestamp?: unknown },
    timestamp: timestamp as unknown,
    sent_at: "2018-07-20T16:45:05.000Z",
  };
}

describe("verifyWompiEvent (event signature)", () => {
  it("accepts a real-shaped event: timestamp at the root", () => {
    const event = signedEvent();
    expect(verifyWompiEvent(event, null, SECRET)).toEqual({ valid: true, checksum: event.signature.checksum });
  });

  it("also accepts the timestamp inside signature, and rejects two different ones", () => {
    const inside = signedEvent();
    inside.signature.timestamp = inside.timestamp;
    delete (inside as { timestamp?: unknown }).timestamp;
    expect(verifyWompiEvent(inside, null, SECRET).valid).toBe(true);

    const both = signedEvent();
    both.signature.timestamp = 1530291412;
    expect(verifyWompiEvent(both, null, SECRET)).toEqual({ valid: false, reason: "invalid_timestamp" });
  });

  it("rejects zero, negative, unsafe or text timestamps", () => {
    for (const bad of [0, -1, 1e21, 1.5, "1530291411"]) {
      const event = signedEvent();
      event.timestamp = bad;
      expect(verifyWompiEvent(event, null, SECRET)).toEqual({ valid: false, reason: "invalid_timestamp" });
    }
  });

  it("accepts the X-Event-Checksum header in any case when it matches", () => {
    const event = signedEvent();
    expect(verifyWompiEvent(event, event.signature.checksum.toLowerCase(), SECRET).valid).toBe(true);
  });

  it("rejects a header that does not match the body", () => {
    expect(verifyWompiEvent(signedEvent(), "A".repeat(64), SECRET)).toEqual({
      valid: false,
      reason: "header_mismatch",
    });
  });

  it("rejects a tampered status", () => {
    const event = signedEvent();
    event.data.transaction.status = "DECLINED";
    expect(verifyWompiEvent(event, null, SECRET)).toEqual({ valid: false, reason: "checksum_mismatch" });
  });

  it("rejects an event signed with another secret", () => {
    expect(verifyWompiEvent(signedEvent({ secret: "test_events_OTHER" }), null, SECRET).valid).toBe(false);
  });

  it("fails closed with an empty events secret", () => {
    const unsigned = signedEvent({ secret: "" });
    expect(verifyWompiEvent(unsigned, null, "")).toEqual({ valid: false, reason: "missing_secret" });
    expect(verifyWompiEvent(unsigned, null, "   ")).toEqual({ valid: false, reason: "missing_secret" });
    expect(computeEventChecksum(unsigned.data, ["transaction.id"], 1, "")).toBeNull();
  });

  it("reads the properties from the event, in their order", () => {
    const event = signedEvent();
    event.signature.properties = ["transaction.status", "transaction.id"];
    event.signature.checksum = sha(`APPROVED1234-1610641025-49201${event.timestamp as number}${SECRET}`);
    expect(verifyWompiEvent(event, null, SECRET).valid).toBe(true);
  });

  it("limits the number and shape of properties (public endpoint)", () => {
    const tooMany = signedEvent();
    tooMany.signature.properties = Array.from({ length: 33 }, () => "transaction.id");
    expect(verifyWompiEvent(tooMany, null, SECRET)).toEqual({ valid: false, reason: "missing_signature" });

    for (const bad of ["transaction..id", ".id", "transaction.", "a".repeat(129), "transaction.id; drop"]) {
      const event = signedEvent();
      event.signature.properties = [bad];
      expect(verifyWompiEvent(event, null, SECRET)).toEqual({ valid: false, reason: "missing_signature" });
    }
  });

  it("rejects a missing property or signature", () => {
    const event = signedEvent();
    event.signature.properties = ["transaction.nope"];
    expect(verifyWompiEvent(event, null, SECRET)).toEqual({ valid: false, reason: "missing_property" });
    expect(verifyWompiEvent({ data: {}, timestamp: 1 }, null, SECRET)).toEqual({
      valid: false,
      reason: "missing_signature",
    });
  });

  it("does not follow inherited keys or arrays", () => {
    expect(computeEventChecksum({}, ["constructor.name"], 1, SECRET)).toBeNull();
    expect(computeEventChecksum({ list: [10, 20] }, ["list.0"], 1, SECRET)).toBeNull();
    expect(computeEventChecksum({ list: [10, 20] }, ["list.length"], 1, SECRET)).toBeNull();
  });
});

describe("checkout", () => {
  it("builds the integrity signature with the expiration date before the secret", () => {
    const signature = integritySignature({
      reference: "sk8-438k4-xmxm392-sn2m",
      amountInCents: 2490000,
      currency: "COP",
      expirationTime: "2023-06-09T20:28:50.000Z",
      integritySecret: "test_integrity_EXAMPLE",
    });
    expect(signature).toBe(
      createHash("sha256")
        .update("sk8-438k4-xmxm392-sn2m2490000COP2023-06-09T20:28:50.000Ztest_integrity_EXAMPLE")
        .digest("hex"),
    );
  });

  it("omits the return URL on localhost (Wompi's CDN blocks it with 403)", () => {
    expect(checkoutRedirectUrl("http://localhost:3000", "o1")).toBeNull();
    expect(checkoutRedirectUrl("http://127.0.0.1:3000", "o1")).toBeNull();
    expect(checkoutRedirectUrl("http://lvh.me:3000", "o1")).toBe("http://lvh.me:3000/orders/o1/payment-return");
    expect(checkoutRedirectUrl("https://tienda.example", "o1")).toBe("https://tienda.example/orders/o1/payment-return");
  });

  it("does not send redirect-url when there is none", () => {
    const config = parseWompiConfig({
      WOMPI_ENV: "sandbox",
      WOMPI_PUBLIC_KEY: "pub_test_X",
      WOMPI_PRIVATE_KEY: "prv_test_X",
      WOMPI_EVENTS_SECRET: "test_events_X",
      WOMPI_INTEGRITY_SECRET: "test_integrity_X",
    });
    const url = new URL(
      buildCheckoutUrl(config, { reference: "R-1", amountInCents: 100, expiresAt: "2026-11-07T20:00:00Z", redirectUrl: null }),
    );
    expect(url.searchParams.has("redirect-url")).toBe(false);
  });

  it("converts pesos to cents only at the edge, with integers", () => {
    expect(copToCents(90000)).toBe(9000000);
    expect(() => copToCents(10.5)).toThrow();
  });

  it("signs every checkout parameter and never exposes secrets", () => {
    const config = parseWompiConfig({
      WOMPI_ENV: "sandbox",
      WOMPI_PUBLIC_KEY: "pub_test_X",
      WOMPI_PRIVATE_KEY: "prv_test_X",
      WOMPI_EVENTS_SECRET: "test_events_X",
      WOMPI_INTEGRITY_SECRET: "test_integrity_X",
    });
    const url = new URL(
      buildCheckoutUrl(config, {
        reference: "ABC-1",
        amountInCents: 9000000,
        expiresAt: "2026-11-07T20:00:00Z",
        redirectUrl: "http://localhost:3000/orders/1/payment-return",
        customerEmail: "a@b.co",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://checkout.wompi.co/p/");
    expect(url.searchParams.get("amount-in-cents")).toBe("9000000");
    expect(url.searchParams.get("expiration-time")).toBe("2026-11-07T20:00:00.000Z");
    expect(url.searchParams.get("signature:integrity")).toHaveLength(64);
    expect(url.toString()).not.toContain("prv_test_");
    expect(url.toString()).not.toContain("test_integrity_");
    expect(url.toString()).not.toContain("test_events_");
  });
});

describe("parseWompiConfig", () => {
  const SANDBOX = {
    WOMPI_ENV: "sandbox",
    WOMPI_PUBLIC_KEY: "pub_test_X",
    WOMPI_PRIVATE_KEY: "prv_test_X",
    WOMPI_EVENTS_SECRET: "test_events_X",
    WOMPI_INTEGRITY_SECRET: "test_integrity_X",
  };

  it("uses the sandbox API with sandbox keys", () => {
    expect(parseWompiConfig(SANDBOX).apiUrl).toBe("https://sandbox.wompi.co/v1");
  });

  it("refuses to mix sandbox and production keys", () => {
    expect(() => parseWompiConfig({ ...SANDBOX, WOMPI_PRIVATE_KEY: "prv_prod_X" })).toThrow(/must not be mixed/);
    expect(() => parseWompiConfig({ ...SANDBOX, WOMPI_ENV: "production" })).toThrow(/must not be mixed/);
  });

  it("never puts a key value in the error message", () => {
    try {
      parseWompiConfig({ ...SANDBOX, WOMPI_PRIVATE_KEY: "prv_prod_SECRETVALUE" });
    } catch (error) {
      expect(String(error)).not.toContain("SECRETVALUE");
    }
  });
});
