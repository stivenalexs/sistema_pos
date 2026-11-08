// Staff and wholesale review rules without I/O (D-054). The database checks
// the same rules again; this gives clear messages early.

import { passwordError } from "./password";

export { passwordError };

export type StaffRole = "admin" | "cashier" | "courier" | "warehouse";

export const STAFF_ROLES: readonly StaffRole[] = ["admin", "cashier", "courier", "warehouse"];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Administrador",
  cashier: "Cajero",
  courier: "Mensajero",
  warehouse: "Bodega",
};

/** Where each role lands after signing in for the first time. */
export const STAFF_HOME: Record<StaffRole, string> = {
  admin: "/admin",
  cashier: "/pos",
  courier: "/courier",
  warehouse: "/admin/inventario",
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** Pages only for people without a session (D-065). */
export const SIGNED_OUT_ONLY_PATHS = ["/login", "/signup"] as const;

/**
 * Where a signed-in person goes when they open a signed-out-only page:
 * the safe `next` they asked for, otherwise their role home (customers, "/").
 */
export function signedInDestination(role: unknown, safeNext: string | null): string {
  if (safeNext && safeNext !== "/") return safeNext;
  return isStaffRole(role) ? STAFF_HOME[role] : "/";
}

export type InviteInput = { email: string; fullName: string; phone: string | null; role: StaffRole };
export type InviteField = keyof InviteInput;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateInvite(raw: {
  email: unknown;
  fullName: unknown;
  phone: unknown;
  role: unknown;
}): { ok: true; value: InviteInput } | { ok: false; errors: Partial<Record<InviteField, string>> } {
  const errors: Partial<Record<InviteField, string>> = {};
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const fullName = typeof raw.fullName === "string" ? raw.fullName.trim() : "";
  const phone = typeof raw.phone === "string" ? raw.phone.trim() : "";
  if (!EMAIL.test(email) || email.length > 254) errors.email = "Escribe un correo válido.";
  if (fullName.length < 3 || fullName.length > 120) errors.fullName = "Escribe el nombre completo.";
  if (phone && !/^[0-9+ ]{7,20}$/.test(phone)) errors.phone = "Teléfono no válido.";
  if (!isStaffRole(raw.role)) errors.role = "Elige el rol.";
  if (Object.keys(errors).length > 0 || !isStaffRole(raw.role)) return { ok: false, errors };
  return { ok: true, value: { email, fullName, phone: phone || null, role: raw.role } };
}

/** A reason of 3 to 300 characters, trimmed. */
export function cleanReason(value: unknown): string | null {
  const reason = typeof value === "string" ? value.trim() : "";
  return reason.length >= 3 && reason.length <= 300 ? reason : null;
}

export const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  admin_forbidden: "Solo un administrador puede hacer esto.",
  invalid_email: "Escribe un correo válido.",
  invalid_name: "Escribe el nombre completo.",
  invalid_phone: "Teléfono no válido.",
  invalid_role: "Elige el rol.",
  email_has_account: "Ese correo ya tiene una cuenta. Usa otro correo para el personal.",
  invite_email_failed: "No se pudo enviar el correo de invitación. La invitación se anuló; intenta de nuevo.",
  cannot_deactivate_self: "No puedes desactivar tu propia cuenta.",
  invalid_reason: "Escribe el motivo (entre 3 y 300 caracteres).",
  not_staff: "Esa cuenta no es del personal.",
  invalid_decision: "Decisión no válida.",
  not_wholesale: "Ese cliente no es mayorista.",
  no_change: "El mayorista ya está en ese estado.",
};
