import "server-only";

import { createSupabaseServerClient } from "@/shared/supabase/server";

import { parseSalesBlock, type SalesBlock, type SalesChannel } from "../domain/sales-block";

/**
 * The block that applies now to a channel in a municipality (the store's when
 * none is given), or null. For notices only: placing an order and starting a
 * payment are blocked again inside the database (D-051).
 */
export async function getSalesBlock(options: { channel?: SalesChannel; zoneId?: string | null } = {}): Promise<SalesBlock | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_sales_block", {
    p_channel: options.channel ?? "web",
    // The function accepts null (store municipality); the generated types mark it as string.
    p_zone_id: (options.zoneId ?? null) as string,
  });
  if (error) throw new Error(`get_sales_block failed: ${error.message}`);
  return parseSalesBlock(data);
}
