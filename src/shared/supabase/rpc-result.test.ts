import { describe, expect, it } from "vitest";

import { readRpcResult, rpcFailureMessage } from "./rpc-result";

const MESSAGES = { admin_forbidden: "Solo un administrador.", invalid_reason: "Escribe el motivo." };

describe("readRpcResult (D-075)", () => {
  it("returns the answer of a success", () => {
    const result = readRpcResult<{ ok: true; credit_note_id: string }>(
      { data: { ok: true, credit_note_id: "cn-1" }, error: null },
      MESSAGES,
    );
    expect(result).toEqual({ ok: true, value: { ok: true, credit_note_id: "cn-1" } });
  });

  it("reads the code of a refusal returned as data, keeping the rest", () => {
    const result = readRpcResult({ data: { ok: false, error: "invalid_reason", status: "queued" }, error: null }, MESSAGES);
    expect(result).toEqual({ ok: false, code: "invalid_reason", value: { ok: false, error: "invalid_reason", status: "queued" } });
  });

  it("finds a known code inside a raised error", () => {
    const result = readRpcResult({ data: null, error: { message: 'P0001: admin_forbidden' } }, MESSAGES);
    expect(result).toEqual({ ok: false, code: "admin_forbidden", value: null });
  });

  it("an unknown raised error, null data or ok:false without a code are failures, never a success", () => {
    expect(readRpcResult({ data: null, error: { message: "boom" } }, MESSAGES)).toMatchObject({ ok: false, code: null });
    expect(readRpcResult({ data: null, error: null }, MESSAGES)).toMatchObject({ ok: false, code: null });
    expect(readRpcResult({ data: { ok: false }, error: null }, MESSAGES)).toMatchObject({ ok: false, code: null });
    expect(readRpcResult({ data: [1], error: null }, MESSAGES).ok).toBe(false);
  });
});

describe("rpcFailureMessage", () => {
  it("uses the known message or the fallback, never an inherited key", () => {
    expect(rpcFailureMessage({ ok: false, code: "invalid_reason", value: null }, MESSAGES, "Falló.")).toBe("Escribe el motivo.");
    expect(rpcFailureMessage({ ok: false, code: "other", value: null }, MESSAGES, "Falló.")).toBe("Falló.");
    expect(rpcFailureMessage({ ok: false, code: "constructor", value: null }, MESSAGES, "Falló.")).toBe("Falló.");
    expect(rpcFailureMessage({ ok: false, code: null, value: null }, MESSAGES, "Falló.")).toBe("Falló.");
  });
});

describe("readRaisedError", () => {
  it("is null without an error, and a failure with the known code otherwise", async () => {
    const { readRaisedError } = await import("./rpc-result");
    expect(readRaisedError(null, MESSAGES)).toBeNull();
    expect(readRaisedError({ message: "x admin_forbidden" }, MESSAGES)).toEqual({ ok: false, code: "admin_forbidden", value: null });
  });
});
