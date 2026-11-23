"use client";

import { useActionState, useEffect, useRef } from "react";

import { type ActionFormState, IDEMPOTENCY_FIELD } from "./action-form-state";
import { FormSubmitButton } from "./form-submit-button";

export type { ActionFormState };

// Synchronous admin form (D-056, D-077): the submit freezes on the first
// click (FormSubmitButton), a rejected form keeps what was typed and a
// successful one starts empty. The server action comes from the page, so
// this file imports no server code.
//
// With `idempotent`, it is the form for actions that record something once
// (inventory movements): it also sends an idempotency key, and the database
// has a UNIQUE constraint on it (agents.md §5.3). One key per intention
// (D-034): a retry after a network error reuses the key; it changes only
// when the server gives a final answer (recorded or rejected). Without it
// (settings, rules, assignments: repeating them leaves the same state), no
// key is sent.

export type ActionFormField =
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
  | { kind: "select"; name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string }
  /** Date and time without zone ("2026-11-14T18:00"); the server says which zone it is. */
  | { kind: "datetime"; name: string; label: string; required?: boolean; defaultValue?: string }
  | { kind: "time"; name: string; label: string; required?: boolean; defaultValue?: string }
  /** Several values under one name; the kept value after a rejection is comma-joined. */
  | {
      kind: "checkboxes";
      name: string;
      label: string;
      options: { value: string; label: string }[];
      defaultValue?: string;
    };

export type ActionFormProps = {
  action: (previous: ActionFormState, formData: FormData) => Promise<ActionFormState>;
  hidden?: Record<string, string>;
  fields: ActionFormField[];
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  /** Sends an idempotency key, renewed after each final answer. */
  idempotent?: boolean;
};

export function ActionForm({
  action,
  hidden = {},
  fields,
  submitLabel,
  pendingLabel = "Registrando…",
  variant = "secondary",
  idempotent = false,
}: ActionFormProps) {
  const [state, formAction] = useActionState<ActionFormState, FormData>(action, { status: "idle" });
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
      {idempotent ? <input ref={keyRef} type="hidden" name={IDEMPOTENCY_FIELD} defaultValue="" /> : null}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields.map((field) => {
        const defaultValue = keep?.[field.name] ?? field.defaultValue;
        if (field.kind === "checkboxes") {
          const checked = new Set((defaultValue ?? "").split(",").filter(Boolean));
          return (
            <fieldset key={field.name} className="field-label min-w-40 grow">
              <legend className="text-xs">{field.label}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                {field.options.map((option) => (
                  <label key={option.value} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name={field.name}
                      value={option.value}
                      defaultChecked={checked.has(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        if (field.kind === "datetime" || field.kind === "time") {
          return (
            <label key={field.name} className="field-label min-w-40 grow">
              <span className="text-xs">{field.label}</span>
              <input
                name={field.name}
                type={field.kind === "datetime" ? "datetime-local" : "time"}
                required={field.required ?? true}
                defaultValue={defaultValue}
                className="field py-1.5 text-sm tabular-nums"
              />
            </label>
          );
        }
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
