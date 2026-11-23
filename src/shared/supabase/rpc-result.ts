// Reads the answer of an SQL function called with supabase.rpc (D-075).
//
// The project's functions answer in two ways: a business refusal comes back
// as data {"ok": false, "error": "<code>", ...}, and a permission or
// validation failure is raised (the code is inside error.message, for
// example "admin_forbidden"). Every caller used to cast the data and look for
// the code by hand, with messages that drifted apart; and {"ok": false}
// without an error code was taken as a success. This reads both ways once.

export type RpcError = { message: string } | null;

/** A successful answer: the function's JSON object, with ok = true. */
export type RpcSuccess<T> = { ok: true; value: T };

/** A refusal: the known code (or null) and the rest of the answer, if any. */
export type RpcFailure = { ok: false; code: string | null; value: Record<string, unknown> | null };

export type RpcResult<T> = RpcSuccess<T> | RpcFailure;

type Messages = Readonly<Record<string, string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * For functions that do not answer {ok, ...} (they return a value or
 * nothing): the refusal of a raised error, or null if there was none.
 */
export function readRaisedError(error: RpcError, messages: Messages): RpcFailure | null {
  if (!error) return null;
  // Longest codes first, so a code never matches a shorter one inside it.
  const code =
    Object.keys(messages)
      .sort((x, y) => y.length - x.length)
      .find((key) => error.message.includes(key)) ?? null;
  return { ok: false, code, value: null };
}

/**
 * Reads {data, error} from supabase.rpc. A raised error gives the longest
 * code of `messages` that appears in its text; data {"ok": false} gives its
 * "error"; anything that is not {"ok": true, ...} is a failure.
 */
export function readRpcResult<T extends object = Record<string, unknown>>(
  response: { data: unknown; error: RpcError },
  messages: Messages,
): RpcResult<T> {
  const raised = readRaisedError(response.error, messages);
  if (raised) return raised;
  const data = response.data;
  if (isRecord(data) && data.ok === true) return { ok: true, value: data as T };
  if (isRecord(data)) {
    return { ok: false, code: typeof data.error === "string" ? data.error : null, value: data };
  }
  return { ok: false, code: null, value: null };
}

/** The message of a refusal: the known one, or the fallback. */
export function rpcFailureMessage(failure: RpcFailure, messages: Messages, fallback: string): string {
  return (failure.code !== null && Object.hasOwn(messages, failure.code) ? messages[failure.code] : undefined) ?? fallback;
}
