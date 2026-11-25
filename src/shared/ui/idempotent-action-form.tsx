"use client";

import { ActionForm, type ActionFormField, type ActionFormProps } from "./action-form";

export type { IdempotentFormState } from "./idempotent-form-state";
export type IdempotentField = ActionFormField;

// The form for actions that record something once (inventory movements,
// D-056): ActionForm with its idempotency key (D-077).
export function IdempotentActionForm(props: Omit<ActionFormProps, "idempotent">) {
  return <ActionForm {...props} idempotent />;
}
