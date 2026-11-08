"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

// Accessible field errors (WCAG 3.3.1 and 4.1.2, D-062).
// - invalid(name): props for the control: aria-invalid and aria-describedby
//   pointing to its message.
// - error(name): the visible message. Inside a <label> it is aria-hidden so it
//   is not read twice (as part of the name and as the description); the
//   control still gets it through aria-describedby.
// - After each server answer with errors, focus moves to the first invalid
//   control. `errors` must be the object from the action state (a new object
//   only when the server answers), never a fresh `?? {}` per render.

type Errors = Partial<Record<string, string>> | undefined;

export function useFieldErrors(errors: Errors) {
  const base = useId();
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!errors || !Object.values(errors).some(Boolean)) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const id = (name: string) => `${base}-${name}-error`;

  return {
    formRef,
    invalid(name: string) {
      return errors?.[name] ? { "aria-invalid": true as const, "aria-describedby": id(name) } : {};
    },
    error(name: string, { inLabel = true }: { inLabel?: boolean } = {}): ReactNode {
      const message = errors?.[name];
      if (!message) return null;
      return (
        <span id={id(name)} aria-hidden={inLabel || undefined} className="field-error">
          {message}
        </span>
      );
    },
  };
}
