import "server-only";

import { createSupabaseServerClient } from "@/shared/supabase/server";

export type CurrentCustomer = {
  customerType: "retail" | "wholesale";
  wholesaleStatus: "pending" | "approved" | "rejected" | null;
  fullName: string;
};

/** The signed-in customer's own profile, or null for visitors and staff. */
export async function getCurrentCustomer(): Promise<CurrentCustomer | null> {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) return null;

  const { data } = await supabase
    .from("customers")
    .select("customer_type, wholesale_status, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;

  return {
    customerType: data.customer_type,
    wholesaleStatus: data.wholesale_status,
    fullName: data.full_name,
  };
}
