"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

// Submit button for SYNCHRONOUS forms (sign-up, sign-in, age gate): they must
// answer in the same request, so they do not go through the actions queue.
// Same freezing rule as ActionButton (agents.md §5.2, D-035): it locks on the
// first click and unlocks only when the server answers.

export type FormSubmitButtonProps = {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  name?: string;
  value?: string;
};

export function FormSubmitButton({
  children,
  pendingLabel = "Procesando…",
  className = "",
  name,
  value,
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus();
  const lockedRef = useRef(false);

  // Unlock once the submission has finished.
  useEffect(() => {
    if (!pending) lockedRef.current = false;
  }, [pending]);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // The second click arrives before React re-renders with pending = true.
    if (lockedRef.current) {
      event.preventDefault();
      return;
    }
    // Let the browser validate required fields first: an invalid form is not
    // submitted, so it must not lock the button.
    if (!event.currentTarget.form?.checkValidity()) return;
    lockedRef.current = true;
  }

  return (
    <button
      type="submit"
      name={name}
      value={value}
      onClick={handleClick}
      disabled={pending}
      aria-busy={pending}
      className={`rounded-md bg-neutral-900 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
