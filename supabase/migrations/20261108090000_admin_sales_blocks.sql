-- Admin panel, part D-2b: sales block rules (plan step 17d-2b, D-060).
--
-- 1. Rules are created, edited and activated or deactivated, never deleted
--    (like fee rules, D-058); their history sales_block_changes (D-051)
--    stays complete. Only the rule's own columns are writable: id,
--    created_by/updated_by (set by trigger) and the timestamps are not.
-- 2. admin_sales_blocks_overview: the rules, what is blocked right now per
--    municipality and channel, and the latest changes.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

revoke insert, update, delete on public.sales_blocks from authenticated;
grant insert (name, kind, zone_id, channels, starts_at, ends_at, weekdays, start_time, end_time, message, is_active),
      update (name, kind, zone_id, channels, starts_at, ends_at, weekdays, start_time, end_time, message, is_active)
  on public.sales_blocks to authenticated;
drop policy "sales_blocks: admin deletes" on public.sales_blocks;

create index sales_block_changes_created_idx on public.sales_block_changes (created_at desc, id);

-- Everything the sales blocks page shows (admin only; the role check comes
-- first, D-056).
create function public.admin_sales_blocks_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'kind', b.kind, 'zone_id', b.zone_id, 'municipality', z.municipality,
        'channels', to_jsonb(b.channels), 'starts_at', b.starts_at, 'ends_at', b.ends_at,
        'weekdays', to_jsonb(b.weekdays), 'start_time', b.start_time, 'end_time', b.end_time,
        'message', b.message, 'is_active', b.is_active,
        -- sales_block_until ignores is_active: an inactive rule never blocks.
        'blocking_until', case when b.is_active then private.sales_block_until(b, now()) end,
        'created_by', private.staff_display_name(b.created_by),
        'created_at', b.created_at,
        'updated_by', private.staff_display_name(b.updated_by),
        'updated_at', b.updated_at
      ) order by b.is_active desc, b.updated_at desc, b.id)
      from public.sales_blocks b
      left join public.delivery_zones z on z.id = b.zone_id
    ), '[]'::jsonb),
    -- Every municipality and channel blocked now, with the rule and until when.
    -- The POS only sells at the store, so it is evaluated only for the store's
    -- municipality (a department-wide rule is one POS line, not ten).
    'blocked_now', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zone_id', z.id, 'municipality', z.municipality, 'channel', c.channel,
        'block_id', s.block ->> 'block_id', 'name', s.block ->> 'name', 'ends_at', s.block ->> 'ends_at'
      ) order by z.municipality, c.channel)
      from public.delivery_zones z
      cross join (values ('web'), ('pos')) c(channel)
      cross join lateral (select private.sales_block_at(c.channel, z.id, now()) as block) s
      where s.block is not null
        and (c.channel = 'web' or z.id = private.store_zone_id())
    ), '[]'::jsonb),
    'store_zone_id', private.store_zone_id(),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'block_id', ch.block_id, 'operation', ch.operation,
        'name', coalesce(ch.new_row ->> 'name', ch.old_row ->> 'name'),
        'old_row', ch.old_row, 'new_row', ch.new_row,
        'actor', private.staff_display_name(ch.actor_id), 'created_at', ch.created_at
      ) order by ch.created_at desc, ch.id)
      from (select * from public.sales_block_changes order by created_at desc, id limit 30) ch
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_sales_blocks_overview() from public, anon, authenticated;
-- Checks the admin role inside.
grant execute on function public.admin_sales_blocks_overview() to authenticated;
