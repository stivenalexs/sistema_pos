"use client";

import { useActionState } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";

import type { AuthFormState } from "../server/auth-actions";

type Props = {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next: string;
};

const INPUT = "w-full rounded-md border border-neutral-400 px-3 py-2";

export function LoginForm({ action, next }: Props) {
  const [state, formAction] = useActionState(action, { status: "idle" });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.message ? (
        <p role="alert" className="text-red-700">
          {state.message}
        </p>
      ) : null}
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1">
        Correo electrónico
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          defaultValue={state.values?.email}
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1">
        Contraseña
        <input type="password" name="password" required autoComplete="current-password" className={INPUT} />
      </label>
      <FormSubmitButton pendingLabel="Entrando…">Iniciar sesión</FormSubmitButton>
    </form>
  );
}
