"use server";

import { refresh } from "next/cache";

import { createSupabaseServerClient } from "@/shared/supabase/server";
import type { ActionFormState } from "@/shared/ui/action-form-state";

import type { SalesChannel } from "../domain/sales-block";
import { parseSalesBlockRule } from "../domain/sales-block-rule";

// Sales block rules from the admin panel (D-051, D-060). RLS lets only the
// administrator read and write sales_blocks; triggers stamp the author and
// write the history. Rules are never deleted. Saving the same rule twice
// leaves the same state, so these writes need no idempotency key (the
// button still freezes).

export type SalesBlockRule = {
  id: string;
  name: string;
  kind: "date_range" | "weekly";
  zoneId: string | null;
  municipality: string | null;
  channels: SalesChannel[];
  startsAt: string | null;
  endsAt: string | null;
  weekdays: number[] | null;
  startTime: string | null;
  endTime: string | null;
  message: string;
  isActive: boolean;
  blockingUntil: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
};

export type BlockedNow = {
  zoneId: string;
  municipality: string;
  channel: SalesChannel;
  blockId: string;
  name: string;
  endsAt: string;
};

export type SalesBlockChange = {
  blockId: string;
  operation: "insert" | "update" | "delete";
  name: string | null;
  oldRow: Record<string, unknown> | null;
  newRow: Record<string, unknown> | null;
  actor: string | null;
  createdAt: string;
};

export type SalesBlocksOverview = {
  rules: SalesBlockRule[];
  blockedNow: BlockedNow[];
  storeZoneId: string | null;
  changes: SalesBlockChange[];
};

type Row = Record<string, unknown>;

export async function getSalesBlocksOverview(): Promise<SalesBlocksOverview> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_sales_blocks_overview");
  if (error) throw new Error(`admin_sales_blocks_overview failed: ${error.message}`);
  const row = data as { rules: Row[]; blocked_now: Row[]; store_zone_id: string | null; changes: Row[] };
  const time = (v: unknown) => (typeof v === "string" ? v.slice(0, 5) : null);
  return {
    rules: row.rules.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      kind: r.kind as SalesBlockRule["kind"],
      zoneId: (r.zone_id as string | null) ?? null,
      municipality: (r.municipality as string | null) ?? null,
      channels: r.channels as SalesChannel[],
      startsAt: (r.starts_at as string | null) ?? null,
      endsAt: (r.ends_at as string | null) ?? null,
      weekdays: (r.weekdays as number[] | null) ?? null,
      startTime: time(r.start_time),
      endTime: time(r.end_time),
      message: r.message as string,
      isActive: r.is_active as boolean,
      blockingUntil: (r.blocking_until as string | null) ?? null,
      createdBy: (r.created_by as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedBy: (r.updated_by as string | null) ?? null,
      updatedAt: r.updated_at as string,
    })),
    blockedNow: row.blocked_now.map((b) => ({
      zoneId: b.zone_id as string,
      municipality: b.municipality as string,
      channel: b.channel as SalesChannel,
      blockId: b.block_id as string,
      name: b.name as string,
      endsAt: b.ends_at as string,
    })),
    storeZoneId: row.store_zone_id,
    changes: row.changes.map((c) => ({
      blockId: c.block_id as string,
      operation: c.operation as SalesBlockChange["operation"],
      name: (c.name as string | null) ?? null,
      oldRow: (c.old_row as Row | null) ?? null,
      newRow: (c.new_row as Row | null) ?? null,
      actor: (c.actor as string | null) ?? null,
      createdAt: c.created_at as string,
    })),
  };
}

function answer(
  previous: ActionFormState,
  status: "ok" | "error",
  message: string,
  values?: Record<string, string>,
): ActionFormState {
  return { status, message, values, answer: (previous.answer ?? 0) + 1 };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function all(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === "string");
}

export async function saveSalesBlockAction(previous: ActionFormState, formData: FormData): Promise<ActionFormState> {
  const raw = {
    name: text(formData, "name"),
    kind: text(formData, "kind"),
    zoneId: text(formData, "zoneId"),
    channels: all(formData, "channels"),
    startsAt: text(formData, "startsAt"),
    endsAt: text(formData, "endsAt"),
    weekdays: all(formData, "weekdays"),
    startTime: text(formData, "startTime"),
    endTime: text(formData, "endTime"),
    message: text(formData, "message"),
  };
  const values = { ...raw, channels: raw.channels.join(","), weekdays: raw.weekdays.join(",") };
  const parsed = parseSalesBlockRule(raw);
  if (!parsed.ok) return answer(previous, "error", parsed.message, values);

  const v = parsed.value;
  const row = {
    name: v.name,
    kind: v.kind,
    zone_id: v.zoneId,
    channels: v.channels,
    starts_at: v.startsAt,
    ends_at: v.endsAt,
    weekdays: v.weekdays,
    start_time: v.startTime,
    end_time: v.endTime,
    message: v.message,
  };
  const ruleId = text(formData, "ruleId");
  const supabase = await createSupabaseServerClient();
  const { data, error } = ruleId
    ? await supabase.from("sales_blocks").update(row).eq("id", ruleId).select("id")
    : await supabase.from("sales_blocks").insert(row).select("id");
  if (error || !data?.length) return answer(previous, "error", "No se pudo guardar la regla.", values);
  refresh();
  return answer(previous, "ok", ruleId ? "Regla actualizada." : "Regla creada.");
}

export async function setSalesBlockActiveAction(
  previous: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const ruleId = text(formData, "ruleId");
  const active = text(formData, "active") === "true";
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("sales_blocks").update({ is_active: active }).eq("id", ruleId).select("id");
  if (error || !data?.length) return answer(previous, "error", "No se pudo cambiar la regla.");
  refresh();
  return answer(previous, "ok", active ? "Regla activada." : "Regla desactivada.");
}
