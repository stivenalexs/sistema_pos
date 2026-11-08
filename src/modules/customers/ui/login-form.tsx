"use client";

import { useActionState } from "react";

import Image from "next/image";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";
import { PasswordInput } from "@/shared/ui/password-input";

import type { AuthFormState } from "../server/auth-actions";

type Props = {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next: string;
};

export function LoginForm({ action, next }: Props) {
  const [state, formAction] = useActionState(action, { status: "idle" });

  return (
    <form action={formAction} className="flex flex-col gap-[22px]">
      {state.message ? (
        <p role="alert" className="notice notice-danger">
          {state.message}
        </p>
      ) : null}
      <input type="hidden" name="next" value={next} />
      <label className="field-label">
        Correo electrónico
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          defaultValue={state.values?.email}
          placeholder="tu@correo.com"
          className="field"
        />
      </label>
      <label className="field-label">
        Contraseña
        <PasswordInput
          name="password"
          required
          autoComplete="current-password"
          placeholder="Introduce tu contraseña"
        />
      </label>
      <FormSubmitButton pendingLabel="Entrando…" className="mt-2 w-full justify-between">
        Entrar a la cava
        <Image src="/brand/arrow-right.svg" alt="" width={20} height={20} />
      </FormSubmitButton>
    </form>
  );
}
