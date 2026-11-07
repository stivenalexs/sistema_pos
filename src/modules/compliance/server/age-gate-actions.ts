"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  AGE_GATE_COOKIE,
  AGE_GATE_COOKIE_VALUE,
  AGE_GATE_MAX_AGE_SECONDS,
  safeNextPath,
} from "../domain/age-gate";

/** The visitor declares being 18 or older at the entry notice. */
export async function confirmAgeAction(formData: FormData): Promise<void> {
  const next = safeNextPath(String(formData.get("next") ?? "/"));
  const cookieStore = await cookies();
  cookieStore.set(AGE_GATE_COOKIE, AGE_GATE_COOKIE_VALUE, {
    maxAge: AGE_GATE_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect(next);
}
