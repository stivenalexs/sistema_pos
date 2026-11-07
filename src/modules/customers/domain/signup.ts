// Validation of the sign-up form (D-035). Pure, no I/O. The server action runs
// it to show clear messages; the database repeats the critical checks.

import { isOfLegalAge, isValidIsoDate, todayInColombia } from "@/modules/compliance";

export type CustomerTypeInput = "retail" | "wholesale";

export type SignupInput = {
  fullName: string;
  email: string;
  password: string;
  birthDate: string;
  customerType: CustomerTypeInput;
  phone: string | null;
  businessName: string | null;
  nit: string | null;
};

export type SignupField =
  | "fullName"
  | "email"
  | "password"
  | "birthDate"
  | "customerType"
  | "businessName"
  | "nit"
  | "phone"
  | "acceptAge"
  | "acceptTerms"
  | "acceptPrivacy";

export type SignupValidation =
  | { ok: true; data: SignupInput }
  | { ok: false; errors: Partial<Record<SignupField, string>> };

type RawSignup = Partial<Record<SignupField, string | null | undefined>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NIT = /^[0-9]{6,12}(-?[0-9])?$/;
const PHONE = /^\+?[0-9 ]{7,15}$/;

export const PASSWORD_MIN_LENGTH = 8;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function isChecked(value: string | null | undefined): boolean {
  return value === "on" || value === "true";
}

export function validateSignup(raw: RawSignup, today = todayInColombia()): SignupValidation {
  const errors: Partial<Record<SignupField, string>> = {};

  const fullName = clean(raw.fullName);
  if (!fullName) errors.fullName = "Escribe tu nombre completo.";

  const email = clean(raw.email).toLowerCase();
  if (!EMAIL.test(email)) errors.email = "Escribe un correo válido.";

  const password = raw.password ?? "";
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    !/[A-Za-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    errors.password = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`;
  }

  const birthDate = clean(raw.birthDate);
  if (!isValidIsoDate(birthDate) || birthDate > today || birthDate < "1900-01-01") {
    errors.birthDate = "Escribe una fecha de nacimiento válida.";
  } else if (!isOfLegalAge(birthDate, today)) {
    errors.birthDate = "Debes tener 18 años o más para registrarte.";
  }

  const customerType = clean(raw.customerType);
  if (customerType !== "retail" && customerType !== "wholesale") {
    errors.customerType = "Elige el tipo de cliente.";
  }

  const phone = clean(raw.phone) || null;
  if (phone && !PHONE.test(phone)) errors.phone = "Escribe un teléfono válido.";

  let businessName: string | null = null;
  let nit: string | null = null;
  if (customerType === "wholesale") {
    businessName = clean(raw.businessName) || null;
    if (!businessName) errors.businessName = "Escribe la razón social.";
    nit = clean(raw.nit).replace(/[.\s]/g, "") || null;
    if (!nit || !NIT.test(nit)) {
      errors.nit = "Escribe un NIT válido, por ejemplo 900123456-7.";
    }
  }

  if (!isChecked(raw.acceptAge)) errors.acceptAge = "Debes confirmar que eres mayor de edad.";
  if (!isChecked(raw.acceptTerms)) errors.acceptTerms = "Debes aceptar los términos y condiciones.";
  if (!isChecked(raw.acceptPrivacy)) {
    errors.acceptPrivacy = "Debes autorizar el tratamiento de tus datos.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      fullName,
      email,
      password,
      birthDate,
      customerType: customerType as CustomerTypeInput,
      phone,
      businessName,
      nit,
    },
  };
}
