import "server-only";

import { createSupabaseServerClient } from "@/shared/supabase/server";

import { isStaffRole, type StaffRole } from "../domain/staff";

// Admin panel reads (D-054). Everything runs with the administrator's
// session; each database function checks the admin role inside.

/** The signed-in user's internal role, or null. */
export async function getStaffRole(): Promise<StaffRole | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const role = (data?.claims.app_metadata as { staff_role?: unknown } | undefined)?.staff_role;
  return isStaffRole(role) ? role : null;
}

export type AdminSummary = { pendingWholesale: number; staff: number; pendingInvitations: number };

export async function getAdminSummary(): Promise<AdminSummary> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_summary");
  if (error) throw new Error(`admin_summary failed: ${error.message}`);
  const row = data as { pending_wholesale: number; staff: number; pending_invitations: number };
  return { pendingWholesale: row.pending_wholesale, staff: row.staff, pendingInvitations: row.pending_invitations };
}

export type WholesaleApplicant = {
  customerId: string;
  businessName: string | null;
  fullName: string;
  nit: string | null;
  phone: string | null;
  email: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  lastReview: { decision: string; reason: string; createdAt: string } | null;
};

export async function listWholesale(status: "pending" | "approved" | "rejected"): Promise<WholesaleApplicant[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_wholesale", { p_status: status });
  if (error) throw new Error(`admin_list_wholesale failed: ${error.message}`);
  return ((data ?? []) as {
    customer_id: string;
    business_name: string | null;
    full_name: string;
    nit: string | null;
    phone: string | null;
    email: string;
    status: WholesaleApplicant["status"];
    created_at: string;
    last_review: { decision: string; reason: string; created_at: string } | null;
  }[]).map((row) => ({
    customerId: row.customer_id,
    businessName: row.business_name,
    fullName: row.full_name,
    nit: row.nit,
    phone: row.phone,
    email: row.email,
    status: row.status,
    createdAt: row.created_at,
    lastReview: row.last_review
      ? { decision: row.last_review.decision, reason: row.last_review.reason, createdAt: row.last_review.created_at }
      : null,
  }));
}

export type StaffMember = {
  userId: string;
  email: string;
  fullName: string;
  role: StaffRole;
  lastSignInAt: string | null;
};

export type StaffInvitation = {
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
  expiresAt: string;
  expired: boolean;
};

export async function listStaff(): Promise<{ members: StaffMember[]; invitations: StaffInvitation[] }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_staff");
  if (error) throw new Error(`admin_list_staff failed: ${error.message}`);
  const raw = data as {
    members: { user_id: string; email: string; full_name: string; staff_role: StaffRole; last_sign_in_at: string | null }[];
    invitations: { id: string; email: string; full_name: string; staff_role: StaffRole; expires_at: string; expired: boolean }[];
  };
  return {
    members: raw.members.map((m) => ({
      userId: m.user_id,
      email: m.email,
      fullName: m.full_name,
      role: m.staff_role,
      lastSignInAt: m.last_sign_in_at,
    })),
    invitations: raw.invitations.map((i) => ({
      id: i.id,
      email: i.email,
      fullName: i.full_name,
      role: i.staff_role,
      expiresAt: i.expires_at,
      expired: i.expired,
    })),
  };
}
