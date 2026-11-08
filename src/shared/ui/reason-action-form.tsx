"use client";

import { useActionState } from "react";

import { FormSubmitButton } from "./form-submit-button";

// Small admin form: hidden ids, one or more text fields (a reason, a
// reference) and a submit frozen on the first click (agents.md §5.2). The
// server action comes from the page, so this file imports no server code.

export type ReasonFormState = { status: "idle" | "ok" | "error"; message?: string };

export type ReasonField = { name: string; label: string; placeholder?: string; maxLength?: number };

type Props = {
  action: (previous: ReasonFormState, formData: FormData) => Promise<ReasonFormState>;
  hidden: Record<string, string>;
  fields: ReasonField[];
  submitLabel: string;
  pendingLabel?: string;
};

export function ReasonActionForm({ action, hidden, fields, submitLabel, pendingLabel = "Guardando…" }: Props) {
  const [state, formAction] = useActionState<ReasonFormState, FormData>(action, { status: "idle" });
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields.map((field) => (
        <label key={field.name} className="field-label min-w-48 grow">
          <span className="text-xs">{field.label}</span>
          <input
            name={field.name}
            required
            minLength={3}
            maxLength={field.maxLength ?? 300}
            placeholder={field.placeholder}
            className="field py-1.5 text-sm"
          />
        </label>
      ))}
      <FormSubmitButton pendingLabel={pendingLabel} variant="secondary" className="btn-sm">
        {submitLabel}
      </FormSubmitButton>
      {state.message ? (
        <p role="status" className={`w-full text-sm ${state.status === "error" ? "field-error" : "text-success"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
