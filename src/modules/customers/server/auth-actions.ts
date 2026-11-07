"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LEGAL_COPY_VERSION, safeNextPath } from "@/modules/compliance";
import { createSupabaseServerClient } from "@/shared/supabase/server";

import { type SignupField, validateSignup } from "../domain/signup";

// Sign-up, sign-in and sign-out (D-035). Synchronous on purpose: they must
// return the session in the same request, so they do not use the queue.

export type AuthFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<SignupField, string>>;
  /** Values to refill the form after an error. Never the password. */
  values?: Record<string, string>;
};

const GENERIC_ERROR = "No pudimos completar la solicitud. Intenta de nuevo en unos minutos.";

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    fullName: field(formData, "fullName"),
    email: field(formData, "email"),
    password: field(formData, "password"),
    birthDate: field(formData, "birthDate"),
    customerType: field(formData, "customerType"),
    phone: field(formData, "phone"),
    businessName: field(formData, "businessName"),
    nit: field(formData, "nit"),
    acceptAge: field(formData, "acceptAge"),
    acceptTerms: field(formData, "acceptTerms"),
    acceptPrivacy: field(formData, "acceptPrivacy"),
  };
  const values = Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) => key !== "password" && typeof value === "string",
    ),
  ) as Record<string, string>;

  const result = validateSignup(raw);
  if (!result.ok) {
    return {
      status: "error",
      message: "Revisa los campos marcados.",
      fieldErrors: result.errors,
      values,
    };
  }

  const input = result.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${await siteOrigin()}/auth/confirm`,
      // Read by the sign-up trigger, which repeats the age and legal checks
      // and then removes the birth date and NIT from user_metadata.
      data: {
        full_name: input.fullName,
        customer_type: input.customerType,
        birth_date: input.birthDate,
        phone: input.phone,
        business_name: input.businessName,
        nit: input.nit,
        accept_age: true,
        accept_terms: true,
        accept_privacy: true,
        legal_version: LEGAL_COPY_VERSION,
      },
    },
  });

  if (error) {
    if (error.code === "weak_password") {
      return {
        status: "error",
        fieldErrors: { password: "La contraseña es muy débil. Usa letras y números." },
        values,
      };
    }
    if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return { status: "error", message: "Demasiados intentos. Espera unos minutos.", values };
    }
    return { status: "error", message: GENERIC_ERROR, values };
  }

  // With email confirmation on, Supabase answers the same way when the email
  // already exists, so the message does not reveal registered emails.
  return {
    status: "success",
    message:
      input.customerType === "wholesale"
        ? "Te enviamos un correo para confirmar tu cuenta. Cuando la confirmes, revisaremos tus datos de mayorista; mientras tanto verás los precios minoristas."
        : "Te enviamos un correo para confirmar tu cuenta.",
  };
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = (field(formData, "email") ?? "").trim().toLowerCase();
  const password = field(formData, "password") ?? "";
  const next = safeNextPath(field(formData, "next"));

  if (!email || !password) {
    return { status: "error", message: "Escribe tu correo y tu contraseña.", values: { email } };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        status: "error",
        message: "Confirma tu correo antes de entrar. Revisa tu bandeja de entrada.",
        values: { email },
      };
    }
    if (error.code === "invalid_credentials") {
      return { status: "error", message: "El correo o la contraseña no son correctos.", values: { email } };
    }
    return { status: "error", message: GENERIC_ERROR, values: { email } };
  }

  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
