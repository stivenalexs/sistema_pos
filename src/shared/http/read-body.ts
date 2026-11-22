// Reads a request body with a hard limit on its size (D-074).
//
// Content-Length is only a hint: a chunked request has none, and a client
// can lie about it. request.text() and request.formData() read the whole
// body before anyone can check its size, so the body is read as a stream and
// the reading stops as soon as it passes the limit.

export type LimitedBody =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; error: "payload_too_large" | "unreadable_body" };

export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<LimitedBody> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, error: "payload_too_large" };
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array(new ArrayBuffer(0)) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: "payload_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "unreadable_body" };
  }

  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** Parses a multipart or urlencoded body already read with its limit. */
export async function parseFormBody(bytes: Uint8Array<ArrayBuffer>, contentType: string | null): Promise<FormData | null> {
  try {
    return await new Response(bytes, { headers: { "Content-Type": contentType ?? "" } }).formData();
  } catch {
    return null;
  }
}
