"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { IDEMPOTENCY_KEY_HEADER } from "@/shared/actions/action-types";
import { ActionButton } from "@/shared/ui/action-button";

import {
  FAILURE_REASON_LABELS,
  FAILURE_REASONS,
  type FailureReason,
  parseProofInput,
  PROOF_ERROR_MESSAGES,
} from "../domain/delivery";
import { SignaturePad } from "./signature-pad";

// Courier screen to close a delivery (D-007): delivered with name, cédula,
// legal age and signature, or a failed attempt with its reason. Sent with
// ActionButton in "completion" mode: it stays locked until the worker has
// recorded the attempt. No animation (agents.md §8).

type Outcome = "delivered" | "failed";

export function DeliveryAttemptForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>("delivered");
  const [recipientName, setRecipientName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [failureReason, setFailureReason] = useState<FailureReason | "">("");
  const [notes, setNotes] = useState("");
  const [signature, setSignature] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = parseProofInput({ outcome, recipientName, documentNumber, ageConfirmed, failureReason, notes });
  const missing =
    !check.ok
      ? (PROOF_ERROR_MESSAGES[check.error] ?? "Revisa los datos.")
      : outcome === "delivered" && !signature
        ? PROOF_ERROR_MESSAGES.signature_missing
        : null;

  async function send(idempotencyKey: string) {
    setError(null);
    const form = new FormData();
    form.set("outcome", outcome);
    form.set("notes", notes);
    if (outcome === "delivered") {
      form.set("recipientName", recipientName);
      form.set("documentNumber", documentNumber);
      form.set("ageConfirmed", ageConfirmed ? "true" : "false");
      if (signature) form.set("signature", signature, "firma.png");
    } else {
      form.set("failureReason", failureReason);
    }

    const response = await fetch(`/api/deliveries/${orderId}/attempts`, {
      method: "POST",
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      body: form,
    });
    const body = (await response.json().catch(() => ({}))) as { trackingId?: string; error?: string };
    if (response.status !== 202 || !body.trackingId) {
      setError((body.error && PROOF_ERROR_MESSAGES[body.error]) ?? "No se pudo enviar. Intenta de nuevo.");
      throw new Error(body.error ?? "request_failed");
    }
    return { trackingId: body.trackingId };
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Resultado</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="outcome" checked={outcome === "delivered"} onChange={() => setOutcome("delivered")} />
          Entregado
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="outcome" checked={outcome === "failed"} onChange={() => setOutcome("failed")} />
          No se pudo entregar
        </label>
      </fieldset>

      {outcome === "delivered" ? (
        <>
          <label className="flex flex-col gap-1">
            Nombre de quien recibe
            <input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              maxLength={120}
              autoComplete="off"
              className="rounded-md border border-neutral-400 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            Número de cédula
            <input
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              inputMode="numeric"
              maxLength={16}
              autoComplete="off"
              className="rounded-md border border-neutral-400 px-3 py-2"
            />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} className="mt-1" />
            <span>Revisé la cédula y quien recibe es mayor de edad.</span>
          </label>
          <div className="flex flex-col gap-1">
            <span>Firma de quien recibe</span>
            <SignaturePad onChange={setSignature} />
          </div>
        </>
      ) : (
        <label className="flex flex-col gap-1">
          Motivo
          <select
            value={failureReason}
            onChange={(e) => setFailureReason(e.target.value as FailureReason | "")}
            className="rounded-md border border-neutral-400 px-3 py-2"
          >
            <option value="">Elige el motivo</option>
            {FAILURE_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {FAILURE_REASON_LABELS[reason]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        Notas (opcional)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={2}
          className="rounded-md border border-neutral-400 px-3 py-2"
        />
      </label>

      {missing ? <p className="text-sm text-neutral-700">{missing}</p> : null}
      <ActionButton
        mode="completion"
        onAccept={send}
        disabled={missing !== null}
        onFinished={(status) => {
          if (status.status === "succeeded") router.push("/courier");
        }}
      >
        {outcome === "delivered" ? "Confirmar entrega" : "Registrar intento fallido"}
      </ActionButton>
      {error ? (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
