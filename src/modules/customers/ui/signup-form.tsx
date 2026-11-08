"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";
import { PasswordInput } from "@/shared/ui/password-input";

import type { AuthFormState } from "../server/auth-actions";

type LegalTexts = {
  ageDeclaration: string;
  terms: string;
  privacy: string;
};

type Props = {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  legal: LegalTexts;
  maxBirthDate: string;
};

function FieldError({ message }: { message: string | undefined }) {
  return message ? <p className="field-error">{message}</p> : null;
}

export function SignupForm({ action, legal, maxBirthDate }: Props) {
  const [state, formAction] = useActionState(action, { status: "idle" });
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const [customerType, setCustomerType] = useState(v.customerType ?? "retail");

  if (state.status === "success") {
    return (
      <div role="status" className="notice notice-success">
        <p>{state.message}</p>
        <p className="mt-2">
          <Link href="/login" className="link">
            Ir a iniciar sesión
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-[22px]" noValidate={false}>
      {state.message ? (
        <p role="alert" className="notice notice-danger">
          {state.message}
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-medium">Tipo de cliente</legend>
        <label className="option flex items-center gap-3 text-sm" aria-current={customerType === "retail" ? "true" : undefined}>
          <input
            type="radio"
            name="customerType"
            value="retail"
            checked={customerType === "retail"}
            onChange={() => setCustomerType("retail")}
          />
          Minorista (compras por unidad)
        </label>
        <label className="option flex items-center gap-3 text-sm" aria-current={customerType === "wholesale" ? "true" : undefined}>
          <input
            type="radio"
            name="customerType"
            value="wholesale"
            checked={customerType === "wholesale"}
            onChange={() => setCustomerType("wholesale")}
          />
          Mayorista (compras por caja; requiere aprobación)
        </label>
        <FieldError message={e.customerType} />
      </fieldset>

      <label className="field-label">
        Nombre completo
        <input name="fullName" required autoComplete="name" defaultValue={v.fullName} className="field" />
        <FieldError message={e.fullName} />
      </label>

      {customerType === "wholesale" ? (
        <>
          <label className="field-label">
            Razón social
            <input name="businessName" required autoComplete="organization" defaultValue={v.businessName} className="field" />
            <FieldError message={e.businessName} />
          </label>
          <label className="field-label">
            NIT
            <input name="nit" required inputMode="numeric" placeholder="900123456-7" defaultValue={v.nit} className="field" />
            <FieldError message={e.nit} />
          </label>
        </>
      ) : null}

      <label className="field-label">
        Fecha de nacimiento
        <input
          type="date"
          name="birthDate"
          required
          max={maxBirthDate}
          autoComplete="bday"
          defaultValue={v.birthDate}
          className="field"
        />
        <FieldError message={e.birthDate} />
      </label>

      <label className="field-label">
        Teléfono (opcional)
        <input type="tel" name="phone" autoComplete="tel" defaultValue={v.phone} className="field" />
        <FieldError message={e.phone} />
      </label>

      <label className="field-label">
        Correo electrónico
        <input type="email" name="email" required autoComplete="email" defaultValue={v.email} className="field" />
        <FieldError message={e.email} />
      </label>

      <label className="field-label">
        Contraseña
        <PasswordInput name="password" required minLength={8} autoComplete="new-password" />
        <span className="field-help">Mínimo 8 caracteres, con letras y números.</span>
        <FieldError message={e.password} />
      </label>

      <label className="flex items-start gap-3 text-sm leading-relaxed text-muted">
        <input type="checkbox" name="acceptAge" required className="mt-1 shrink-0" defaultChecked={v.acceptAge === "on"} />
        <span>{legal.ageDeclaration}</span>
      </label>
      <FieldError message={e.acceptAge} />

      <label className="flex items-start gap-3 text-sm leading-relaxed text-muted">
        <input type="checkbox" name="acceptTerms" required className="mt-1 shrink-0" defaultChecked={v.acceptTerms === "on"} />
        <span>{legal.terms}</span>
      </label>
      <FieldError message={e.acceptTerms} />

      <label className="flex items-start gap-3 text-sm leading-relaxed text-muted">
        <input type="checkbox" name="acceptPrivacy" required className="mt-1 shrink-0" defaultChecked={v.acceptPrivacy === "on"} />
        <span>{legal.privacy}</span>
      </label>
      <FieldError message={e.acceptPrivacy} />

      <FormSubmitButton pendingLabel="Creando cuenta…" className="mt-2 w-full">Crear cuenta</FormSubmitButton>
    </form>
  );
}
