"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  type AcceptedAction,
  type ActionStatusResponse,
  isFinalActionStatus,
} from "../actions/action-types";
import { fetchActionStatus } from "../actions/client";

// The only allowed way to trigger an action or a payment (agents.md §5.2, D-034).
//
// - Locks on the first click, synchronously, before React re-renders.
// - One idempotency key per INTENT: retrying after a failed request reuses
//   the same key; a new key is generated only after the intent ends
//   (accepted, succeeded or failed for good).
// - mode "tracking": unlocks when the server returns the tracking_id.
// - mode "completion" (payments): unlocks when the action finishes.
// - No animation hides the locked state (agents.md §8).

export type ButtonVariant = "primary" | "secondary";

export type ActionButtonMode = "tracking" | "completion";

type Phase =
  | "idle"
  | "sending"
  | "waiting"
  | "accepted"
  | "succeeded"
  | "failed"
  | "request_error";

export type ActionButtonProps = {
  children: ReactNode;
  /** Sends the action with the given key and returns its tracking_id. */
  onAccept: (idempotencyKey: string) => Promise<AcceptedAction>;
  mode?: ActionButtonMode;
  /** Status reader for "completion" mode. Defaults to GET /api/actions/{id}. */
  getStatus?: (trackingId: string) => Promise<ActionStatusResponse>;
  pollIntervalMs?: number;
  onTracked?: (trackingId: string) => void;
  onFinished?: (status: ActionStatusResponse) => void;
  disabled?: boolean;
  /** Visual style only; the locking rules are the same. */
  variant?: ButtonVariant;
  className?: string;
};

const MESSAGES: Record<Phase, string> = {
  idle: "",
  sending: "Procesando…",
  waiting: "Procesando…",
  accepted: "Recibido. Lo estamos procesando.",
  succeeded: "Listo.",
  failed: "No se pudo completar. Puedes intentarlo de nuevo.",
  request_error:
    "No pudimos enviar la solicitud. Revisa tu conexión e intenta de nuevo.",
};

function newKey(): string {
  return crypto.randomUUID();
}

export function ActionButton({
  children,
  onAccept,
  mode = "tracking",
  getStatus = fetchActionStatus,
  pollIntervalMs = 1500,
  onTracked,
  onFinished,
  disabled = false,
  variant = "primary",
  className = "",
}: ActionButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [retrying, setRetrying] = useState(false);
  const lockedRef = useRef(false);
  const keyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function endIntent(next: Phase) {
    keyRef.current = null;
    lockedRef.current = false;
    setRetrying(false);
    setPhase(next);
  }

  function poll(trackingId: string) {
    timerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      try {
        const status = await getStatus(trackingId);
        if (!mountedRef.current) return;
        if (isFinalActionStatus(status.status)) {
          endIntent(status.status === "succeeded" ? "succeeded" : "failed");
          onFinished?.(status);
          return;
        }
        setRetrying(status.retrying);
      } catch {
        // Temporary error while reading the status: keep waiting. The action
        // is already accepted, so the button must stay locked.
      }
      poll(trackingId);
    }, pollIntervalMs);
  }

  async function handleClick() {
    if (lockedRef.current || disabled) return;
    lockedRef.current = true;
    keyRef.current ??= newKey();
    const key = keyRef.current;
    setPhase("sending");

    let accepted: AcceptedAction;
    try {
      accepted = await onAccept(key);
    } catch {
      if (!mountedRef.current) return;
      // Keep the key: the retry must be recognised as the same intent.
      lockedRef.current = false;
      setPhase("request_error");
      return;
    }
    if (!mountedRef.current) return;

    onTracked?.(accepted.trackingId);
    if (mode === "tracking") {
      endIntent("accepted");
      return;
    }
    setPhase("waiting");
    poll(accepted.trackingId);
  }

  const busy = phase === "sending" || phase === "waiting";
  const message =
    phase === "waiting" && retrying ? "Procesando… reintentando" : MESSAGES[phase];

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || disabled}
        aria-busy={busy}
        className={`btn ${variant === "primary" ? "btn-primary" : "btn-secondary"} ${className}`}
      >
        {busy ? "Procesando…" : children}
      </button>
      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {message}
      </p>
    </div>
  );
}
