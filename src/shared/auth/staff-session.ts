import "server-only";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/shared/supabase/server";

import { type StaffRole, staffRoleFromAppMetadata } from "./staff-role";

// The signed-in staff member, read once for every page, route and action
// (D-075). Only for showing or hiding things and sending people to the right
// page: the database checks the role again inside every function (RLS and
// SECURITY DEFINER checks), so this is never the only guard.

export type StaffSession<R extends StaffRole = StaffRole> = { userId: string; role: R };

/** The signed-in user's staff role and id, or null. */
export async function getStaffSession(): Promise<StaffSession | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const role = staffRoleFromAppMetadata(claims?.app_metadata);
  if (!claims?.sub || !role) return null;
  return { userId: claims.sub, role };
}

/** The session if its role is one of `roles`, or null. */
export async function getStaffSessionIn<R extends StaffRole>(roles: readonly R[]): Promise<StaffSession<R> | null> {
  const session = await getStaffSession();
  return session && (roles as readonly StaffRole[]).includes(session.role) ? (session as StaffSession<R>) : null;
}

/**
 * For a page: the session if its role is one of `roles`; otherwise sends the
 * user to the login with `nextPath` to come back to.
 */
export async function requireStaffPage<R extends StaffRole>(roles: readonly R[], nextPath: string): Promise<StaffSession<R>> {
  const session = await getStaffSessionIn(roles);
  if (!session) redirect(`/login?next=${nextPath}`);
  return session;
}
