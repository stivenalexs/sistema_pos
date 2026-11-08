"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseAdminClient } from "@/shared/supabase/admin";
import { createSupabaseServerClient } from "@/shared/supabase/server";

import {
  ADMIN_ERROR_MESSAGES,
  cleanReason,
  type InviteField,
  isStaffRole,
  passwordError,
  STAFF_HOME,
  validateInvite,
} from "../domain/staff";

// Admin panel actions (D-054). Synchronous and small: FormSubmitButton
// (frozen on the first click), like the cart (D-039). The database checks
// the admin role inside every function.

export type AdminFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
  fieldErrors?: Partial<Record<InviteField, string>>;
};

const GENERIC = "No se pudo completar. Intenta de nuevo.";

function fail(code: string | undefined): AdminFormState {
  return { status: "error", message: (code && ADMIN_ERROR_MESSAGES[code]) ?? GENERIC };
}

function errorCode(message: string): string | undefined {
  return Object.keys(ADMIN_ERROR_MESSAGES).find((code) => message.includes(code));
}

export async function reviewWholesaleAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const customerId = formData.get("customerId");
  const decision = formData.get("decision");
  const reason = cleanReason(formData.get("reason"));
  if (typeof customerId !== "string" || (decision !== "approved" && decision !== "rejected")) return fail("invalid_decision");
  if (!reason) return fail("invalid_reason");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("review_wholesale", {
    p_customer_id: customerId,
    p_decision: decision,
    p_reason: reason,
  });
  if (error) return fail(errorCode(error.message));
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return fail(result.error);
  refresh();
  return {
    status: "ok",
    message: decision === "approved"
      ? "Mayorista aprobado. Verá sus precios al renovar su sesión (hasta 1 hora)."
      : "Solicitud rechazada. Sigue comprando como minorista.",
  };
}

/**
 * Records the invitation (database) and sends the email (Supabase Auth). The
 * email needs the secret key: a narrow exception to D-030, used only after
 * the database accepted the invitation with the administrator's session.
 * If the email cannot be sent, the invitation is revoked again.
 */
export async function inviteStaffAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const parsed = validateInvite({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    role: formData.get("role"),
  });
  if (!parsed.ok) return { status: "error", message: "Revisa los campos marcados.", fieldErrors: parsed.errors };
  const { email, fullName, phone, role } = parsed.value;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("invite_staff", {
    p_email: email,
    p_full_name: fullName,
    // The function accepts null; the generated types mark it as string.
    p_phone: phone as string,
    p_staff_role: role,
  });
  if (error) return fail(errorCode(error.message));
  const result = data as { ok: boolean; error?: string; invitation_id?: string; token?: string; resent?: boolean };
  if (!result.ok || !result.invitation_id || !result.token) return fail(result.error);

  // The one-time code lets the database recognise the user created by THIS
  // invitation (a public sign-up with the same email cannot know it). The
  // database removes it from user_metadata right away.
  const { error: sendError } = await createSupabaseAdminClient().auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, staff_invite_token: result.token },
  });
  if (sendError) {
    await supabase.rpc("revoke_staff_invitation", { p_invitation_id: result.invitation_id });
    return fail("invite_email_failed");
  }
  refresh();
  return {
    status: "ok",
    message: result.resent ? `Invitación reenviada a ${email}. El enlace anterior ya no sirve.` : `Invitación enviada a ${email}.`,
  };
}

export async function revokeInvitationAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const id = formData.get("invitationId");
  if (typeof id !== "string") return fail(undefined);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_staff_invitation", { p_invitation_id: id });
  if (error) return fail(errorCode(error.message));
  refresh();
  return { status: "ok", message: "Invitación anulada." };
}

export async function deactivateStaffAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const userId = formData.get("userId");
  const reason = cleanReason(formData.get("reason"));
  if (typeof userId !== "string") return fail(undefined);
  if (!reason) return fail("invalid_reason");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("deactivate_staff", { p_user_id: userId, p_reason: reason });
  if (error) return fail(errorCode(error.message));
  const result = data as { ok: boolean; error?: string; open_deliveries?: number };
  if (!result.ok) return fail(result.error);
  refresh();
  const open = result.open_deliveries ?? 0;
  return {
    status: "ok",
    message:
      "Cuenta desactivada. Su sesión abierta vence en máximo 1 hora." +
      (open > 0 ? ` Tenía ${open} ${open === 1 ? "entrega" : "entregas"} en camino: reasígnalas.` : ""),
  };
}

export type PasswordFormState = { status: "idle" | "error"; message?: string };

/** First password of an invited staff member (session from the invite link). */
export async function setPasswordAction(_previous: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (typeof password !== "string" || typeof confirm !== "string") return { status: "error", message: GENERIC };
  const rule = passwordError(password);
  if (rule) return { status: "error", message: rule };
  if (password !== confirm) return { status: "error", message: "Las dos contraseñas no coinciden." };

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return { status: "error", message: "El enlace venció. Pide al administrador una invitación nueva." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { status: "error", message: GENERIC };

  const role = (claims.claims.app_metadata as { staff_role?: unknown } | undefined)?.staff_role;
  redirect(isStaffRole(role) ? STAFF_HOME[role] : "/");
}
