"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { IDEMPOTENCY_KEY_HEADER } from "@/shared/actions/action-types";
import { ActionButton } from "@/shared/ui/action-button";

import { FAILURE_REASON_GROUPS, FAILURE_REASON_LABELS, type FailureReason, parseProofInput, PROOF_ERROR_MESSAGES } from "../domain/proof";
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
        <legend className="mb-2 text-[13px] font-medium">Resultado</legend>
        <label className="option flex items-center gap-3" aria-current={outcome === "delivered" ? "true" : undefined}>
          <input type="radio" name="outcome" checked={outcome === "delivered"} onChange={() => setOutcome("delivered")} />
          Entregado
        </label>
        <label className="option flex items-center gap-3" aria-current={outcome === "failed" ? "true" : undefined}>
          <input type="radio" name="outcome" checked={outcome === "failed"} onChange={() => setOutcome("failed")} />
          No se pudo entregar
        </label>
      </fieldset>

      {outcome === "delivered" ? (
        <>
          <label className="field-label">
            Nombre de quien recibe
            <input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              maxLength={120}
              autoComplete="off"
              className="field"
            />
          </label>
          <label className="field-label">
            Número de cédula
            <input
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
              inputMode="numeric"
              maxLength={16}
              autoComplete="off"
              className="field"
            />
          </label>
          <label className="flex items-start gap-3 text-sm leading-relaxed">
            <input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} className="mt-1 shrink-0" />
            <span>Revisé la cédula y quien recibe es mayor de edad.</span>
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">Firma de quien recibe</span>
            <SignaturePad onChange={setSignature} />
          </div>
        </>
      ) : (
        <label className="field-label">
          Motivo
          <select
            value={failureReason}
            onChange={(e) => setFailureReason(e.target.value as FailureReason | "")}
            className="field"
          >
            <option value="">Elige el motivo</option>
            {FAILURE_REASON_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.reasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {FAILURE_REASON_LABELS[reason]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      <label className="field-label">
        Notas (opcional)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={2}
          className="field"
        />
      </label>

      {missing ? <p className="text-sm text-warning">{missing}</p> : null}
      <ActionButton
        mode="completion"
        className="w-full"
        onAccept={send}
        disabled={missing !== null}
        onFinished={(status) => {
          if (status.status === "succeeded") router.push("/courier");
        }}
      >
        {outcome === "delivered" ? "Confirmar entrega" : "Registrar intento fallido"}
      </ActionButton>
      {error ? (
        <p role="alert" className="notice notice-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
