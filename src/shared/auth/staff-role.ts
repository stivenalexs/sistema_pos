// Internal staff roles (D-031) and how to read them from the JWT (D-075).
// The role lives in app_metadata.staff_role, written only by the server;
// user_metadata is never read. Pure: no I/O.

export type StaffRole = "admin" | "cashier" | "courier" | "warehouse";

export const STAFF_ROLES: readonly StaffRole[] = ["admin", "cashier", "courier", "warehouse"];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** The staff role in a token's app_metadata, or null. */
export function staffRoleFromAppMetadata(appMetadata: unknown): StaffRole | null {
  if (typeof appMetadata !== "object" || appMetadata === null) return null;
  const role = (appMetadata as { staff_role?: unknown }).staff_role;
  return isStaffRole(role) ? role : null;
}
