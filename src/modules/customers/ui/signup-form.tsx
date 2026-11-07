"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { FormSubmitButton } from "@/shared/ui/form-submit-button";

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

const INPUT = "w-full rounded-md border border-neutral-400 px-3 py-2";

function FieldError({ message }: { message: string | undefined }) {
  return message ? <p className="text-sm text-red-700">{message}</p> : null;
}

export function SignupForm({ action, legal, maxBirthDate }: Props) {
  const [state, formAction] = useActionState(action, { status: "idle" });
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const [customerType, setCustomerType] = useState(v.customerType ?? "retail");

  if (state.status === "success") {
    return (
      <div role="status" className="rounded-md border border-green-700 bg-green-50 p-4">
        <p>{state.message}</p>
        <p className="mt-2">
          <Link href="/login" className="underline">
            Ir a iniciar sesión
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate={false}>
      {state.message ? (
        <p role="alert" className="text-red-700">
          {state.message}
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Tipo de cliente</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="customerType"
            value="retail"
            checked={customerType === "retail"}
            onChange={() => setCustomerType("retail")}
          />
          Minorista (compras por unidad)
        </label>
        <label className="flex items-center gap-2">
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

      <label className="flex flex-col gap-1">
        Nombre completo
        <input name="fullName" required autoComplete="name" defaultValue={v.fullName} className={INPUT} />
        <FieldError message={e.fullName} />
      </label>

      {customerType === "wholesale" ? (
        <>
          <label className="flex flex-col gap-1">
            Razón social
            <input name="businessName" required autoComplete="organization" defaultValue={v.businessName} className={INPUT} />
            <FieldError message={e.businessName} />
          </label>
          <label className="flex flex-col gap-1">
            NIT
            <input name="nit" required inputMode="numeric" placeholder="900123456-7" defaultValue={v.nit} className={INPUT} />
            <FieldError message={e.nit} />
          </label>
        </>
      ) : null}

      <label className="flex flex-col gap-1">
        Fecha de nacimiento
        <input
          type="date"
          name="birthDate"
          required
          max={maxBirthDate}
          autoComplete="bday"
          defaultValue={v.birthDate}
          className={INPUT}
        />
        <FieldError message={e.birthDate} />
      </label>

      <label className="flex flex-col gap-1">
        Teléfono (opcional)
        <input type="tel" name="phone" autoComplete="tel" defaultValue={v.phone} className={INPUT} />
        <FieldError message={e.phone} />
      </label>

      <label className="flex flex-col gap-1">
        Correo electrónico
        <input type="email" name="email" required autoComplete="email" defaultValue={v.email} className={INPUT} />
        <FieldError message={e.email} />
      </label>

      <label className="flex flex-col gap-1">
        Contraseña
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={INPUT}
        />
        <span className="text-sm text-neutral-600">Mínimo 8 caracteres, con letras y números.</span>
        <FieldError message={e.password} />
      </label>

      <label className="flex items-start gap-2">
        <input type="checkbox" name="acceptAge" required className="mt-1" defaultChecked={v.acceptAge === "on"} />
        <span>{legal.ageDeclaration}</span>
      </label>
      <FieldError message={e.acceptAge} />

      <label className="flex items-start gap-2">
        <input type="checkbox" name="acceptTerms" required className="mt-1" defaultChecked={v.acceptTerms === "on"} />
        <span>{legal.terms}</span>
      </label>
      <FieldError message={e.acceptTerms} />

      <label className="flex items-start gap-2">
        <input type="checkbox" name="acceptPrivacy" required className="mt-1" defaultChecked={v.acceptPrivacy === "on"} />
        <span>{legal.privacy}</span>
      </label>
      <FieldError message={e.acceptPrivacy} />

      <FormSubmitButton pendingLabel="Creando cuenta…">Crear cuenta</FormSubmitButton>
    </form>
  );
}
