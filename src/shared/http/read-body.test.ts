import { describe, expect, it } from "vitest";

import { parseFormBody, readBodyWithLimit } from "./read-body";

// A chunked body: no Content-Length, delivered in pieces.
function streamed(chunks: number[]): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
  return new Request("http://local.test/x", { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("readBodyWithLimit (D-074)", () => {
  it("reads a body within the limit", async () => {
    const result = await readBodyWithLimit(new Request("http://local.test/x", { method: "POST", body: "hola" }), 10);
    expect(result.ok && new TextDecoder().decode(result.bytes)).toBe("hola");
  });

  it("stops a chunked body without Content-Length as soon as it passes the limit", async () => {
    const request = streamed([600, 600, 600]);
    expect(request.headers.get("content-length")).toBeNull();
    expect(await readBodyWithLimit(request, 1000)).toEqual({ ok: false, error: "payload_too_large" });
  });

  it("rejects a declared Content-Length over the limit without reading", async () => {
    const request = new Request("http://local.test/x", {
      method: "POST",
      body: "x",
      headers: { "content-length": "999999" },
    });
    expect(await readBodyWithLimit(request, 1000)).toEqual({ ok: false, error: "payload_too_large" });
    expect(request.bodyUsed).toBe(false);
  });

  it("does not trust a Content-Length that is smaller than the body", async () => {
    const request = new Request("http://local.test/x", { method: "POST", body: "x".repeat(2000), headers: { "content-length": "10" } });
    expect(await readBodyWithLimit(request, 1000)).toEqual({ ok: false, error: "payload_too_large" });
  });

  it("an empty body is empty", async () => {
    const result = await readBodyWithLimit(new Request("http://local.test/x", { method: "POST" }), 10);
    expect(result.ok && result.bytes.length).toBe(0);
  });
});

describe("parseFormBody", () => {
  it("parses multipart bytes already read", async () => {
    const form = new FormData();
    form.set("outcome", "delivered");
    const request = new Request("http://local.test/x", { method: "POST", body: form });
    const body = await readBodyWithLimit(request, 10_000);
    if (!body.ok) throw new Error("unexpected");
    const parsed = await parseFormBody(body.bytes, request.headers.get("content-type"));
    expect(parsed?.get("outcome")).toBe("delivered");
  });

  it("returns null for a body that is not a form", async () => {
    expect(await parseFormBody(new TextEncoder().encode("{}"), "application/json")).toBeNull();
  });
});
