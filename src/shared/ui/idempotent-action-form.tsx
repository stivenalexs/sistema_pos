"use client";

import { useActionState, useEffect, useRef } from "react";

import { FormSubmitButton } from "./form-submit-button";
import { IDEMPOTENCY_FIELD, type IdempotentFormState } from "./idempotent-form-state";

export type { IdempotentFormState };

// Synchronous form for actions that record something once (inventory
// movements, D-056). Same three layers as ActionButton (agents.md §5.3):
// the submit freezes on the first click, the form sends an idempotency key
// and the database has a UNIQUE constraint on it.
//
// One key per intention (D-034): a retry after a network error reuses the
// key; it changes only when the server gives a final answer (recorded or
// rejected). The server action comes from the page, so this file imports no
// server code.

export type IdempotentField =
  | {
      kind: "text";
      name: string;
      label: string;
      required?: boolean;
      maxLength?: number;
      placeholder?: string;
      defaultValue?: string;
    }
  | {
      kind: "number";
      name: string;
      label: string;
      min: number;
      max: number;
      defaultValue?: string;
      /** False: may be left empty (the server reads it as "no value"). */
      required?: boolean;
    }
  | { kind: "select"; name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string };

type Props = {
  action: (previous: IdempotentFormState, formData: FormData) => Promise<IdempotentFormState>;
  hidden?: Record<string, string>;
  fields: IdempotentField[];
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
};

export function IdempotentActionForm({
  action,
  hidden = {},
  fields,
  submitLabel,
  pendingLabel = "Registrando…",
  variant = "secondary",
}: Props) {
  const [state, formAction] = useActionState<IdempotentFormState, FormData>(action, { status: "idle" });
  // Created in the browser only (a key made while rendering on the server
  // would differ from the browser's). Renewed after each final answer: the
  // intention ended, the next submit is a new one. Until it exists, the
  // server action rejects the form (no key, no movement).
  // The hidden input's value is set directly (for a hidden input the value is
  // its attribute, so resetting the form does not clear it).
  const keyRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (keyRef.current) keyRef.current.value = crypto.randomUUID();
  }, [state.answer]);

  // After a rejection, the form is reset to what was sent; after a success, to empty.
  const keep = state.status === "error" ? state.values : undefined;

  return (
    // Remounted on every final answer, so every field (a select too) starts
    // again from its default: what was sent after a rejection, empty after a
    // success.
    <form key={state.answer ?? 0} action={formAction} className="flex flex-wrap items-end gap-3">
      <input ref={keyRef} type="hidden" name={IDEMPOTENCY_FIELD} defaultValue="" />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields.map((field) => {
        const defaultValue = keep?.[field.name] ?? field.defaultValue;
        return (
          <label key={field.name} className="field-label min-w-40 grow">
            <span className="text-xs">{field.label}</span>
            {field.kind === "select" ? (
              <select name={field.name} required defaultValue={defaultValue ?? ""} className="field py-1.5 text-sm">
                <option value="" disabled>
                  Elige…
                </option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.kind === "number" ? (
              <input
                name={field.name}
                type="number"
                inputMode="numeric"
                required={field.required ?? true}
                step={1}
                min={field.min}
                max={field.max}
                defaultValue={defaultValue}
                className="field py-1.5 text-sm tabular-nums"
              />
            ) : (
              <input
                name={field.name}
                required={field.required ?? true}
                minLength={field.required === false ? undefined : 3}
                maxLength={field.maxLength ?? 300}
                placeholder={field.placeholder}
                defaultValue={defaultValue}
                className="field py-1.5 text-sm"
              />
            )}
          </label>
        );
      })}
      <FormSubmitButton pendingLabel={pendingLabel} variant={variant} className="btn-sm">
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
