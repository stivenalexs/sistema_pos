-- Admin panel, part D-2a: store settings, delivery zones and fee rules
-- (plan step 17d-2a, D-058).
--
-- 1. The configuration history of D-057 (config_changes) also covers
--    delivery_zones, delivery_fee_rules and app_settings.
-- 2. set_store_settings: store location, municipality and maximum delivery
--    distance, validated and written together. app_settings is no longer
--    written directly by signed-in users: a malformed value would break
--    checkout and the sales blocks.
-- 3. Zones: the administrator only activates or deactivates them (D-057).
--    Fee rules: created, edited and activated or deactivated, never deleted;
--    only their business columns, with bounds and no rule that never applies.
-- 4. admin_config_overview: everything the configuration page shows.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------

create trigger log_config_change
  after insert or update or delete on public.delivery_zones
  for each row execute function private.log_config_change();
create trigger log_config_change
  after insert or update or delete on public.delivery_fee_rules
  for each row execute function private.log_config_change();
create trigger log_config_change
  after insert or update or delete on public.app_settings
  for each row execute function private.log_config_change();

-- ---------------------------------------------------------------------------
-- Narrower table privileges
-- ---------------------------------------------------------------------------

-- Zones: only is_active changes; the ten municipalities stay (D-045, D-057).
revoke insert, update, delete on public.delivery_zones from authenticated;
grant update (is_active) on public.delivery_zones to authenticated;
drop policy "delivery_zones: admin inserts" on public.delivery_zones;

-- Fee rules: never deleted (deactivating keeps the history readable), and
-- only their business columns are written: an id or created_at changed by
-- hand would break the history's row_id.
revoke insert, update, delete on public.delivery_fee_rules from authenticated;
grant insert (name, customer_type, min_boxes, max_distance_m, fee_cop, is_active),
      update (name, customer_type, min_boxes, max_distance_m, fee_cop, is_active)
  on public.delivery_fee_rules to authenticated;
drop policy "delivery_fee_rules: admin deletes" on public.delivery_fee_rules;

-- No rule that can never apply and no unbounded values: a retail purchase is
-- always by unit (D-024), so a retail rule with minimum boxes never matches.
alter table public.delivery_fee_rules
  add constraint delivery_fee_rules_name_length check (length(trim(name)) between 3 and 80),
  add constraint delivery_fee_rules_retail_boxes check (customer_type is distinct from 'retail' or min_boxes is null),
  add constraint delivery_fee_rules_bounds check (
    (min_boxes is null or min_boxes <= 10000)
    and (max_distance_m is null or max_distance_m <= 50000)
    and fee_cop <= 1000000
  );

-- Indexes for the configuration page.
create index customer_addresses_zone_idx on public.customer_addresses (zone_id);
create index config_changes_created_idx on public.config_changes (created_at desc, id);

-- Settings: written only through validating functions such as
-- set_store_settings.
revoke update on public.app_settings from authenticated;
drop policy "app_settings: admin updates" on public.app_settings;

-- ---------------------------------------------------------------------------
-- Store settings
-- ---------------------------------------------------------------------------

-- Store point (lat, lng), municipality and maximum delivery distance in
-- meters, together. The point must be in the Valle de Aburrá (a box around
-- its ten municipalities, D-045): a store placed elsewhere in Antioquia by a
-- typing mistake would leave every delivery out of range. The municipality
-- must be one of the zones; it may be inactive for delivery, because it is
-- used for pickup, the POS and the sales blocks (D-051).
-- Returns {"ok": true, "changed": bool} or {"ok": false, "error": code}.
create function public.set_store_settings(
  p_lat double precision,
  p_lng double precision,
  p_zone_id uuid,
  p_max_distance_m integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location jsonb;
  v_rows integer;
begin
  perform private.require_admin();
  if p_lat is null or p_lng is null or p_lat not between 5.95 and 6.55 or p_lng not between -75.75 and -75.15 then
    return jsonb_build_object('ok', false, 'error', 'location_outside_valley');
  end if;
  if p_zone_id is null or not exists (select 1 from public.delivery_zones where id = p_zone_id) then
    return jsonb_build_object('ok', false, 'error', 'unknown_zone');
  end if;
  if p_max_distance_m is null or p_max_distance_m not between 1000 and 50000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_max_distance');
  end if;

  -- Six decimals (about 10 cm) are plenty for a store.
  v_location := jsonb_build_object('lat', round(p_lat::numeric, 6), 'lng', round(p_lng::numeric, 6));

  insert into public.app_settings (key, value) values
    ('store_location', v_location),
    ('store_zone_id', to_jsonb(p_zone_id::text)),
    ('delivery_max_distance_m', to_jsonb(p_max_distance_m))
  on conflict (key) do update set value = excluded.value
  where public.app_settings.value is distinct from excluded.value;

  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'changed', v_rows > 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Configuration page read
-- ---------------------------------------------------------------------------

create function public.admin_config_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'store', jsonb_build_object(
      'location', (select value from public.app_settings where key = 'store_location'),
      'zone_id', private.store_zone_id(),
      'max_distance_m', private.setting_integer('delivery_max_distance_m', 30000)
    ),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', z.id, 'municipality', z.municipality, 'dane_code', z.dane_code, 'is_active', z.is_active,
        'addresses', (select count(*) from public.customer_addresses a where a.zone_id = z.id)
      ) order by z.municipality)
      from public.delivery_zones z
    ), '[]'::jsonb),
    'fee_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'customer_type', r.customer_type, 'min_boxes', r.min_boxes,
        'max_distance_m', r.max_distance_m, 'fee_cop', r.fee_cop, 'is_active', r.is_active
      ) order by r.is_active desc, r.fee_cop, r.name, r.id)
      from public.delivery_fee_rules r
    ), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_name', c.table_name, 'operation', c.operation, 'row_id', c.row_id,
        'old_row', c.old_row, 'new_row', c.new_row, 'created_at', c.created_at,
        'changed_by', private.staff_display_name(c.changed_by)
      ) order by c.created_at desc, c.id)
      from (select * from public.config_changes order by created_at desc, id limit 30) c
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.set_store_settings(double precision, double precision, uuid, integer),
  public.admin_config_overview()
from public, anon, authenticated;

-- Each checks the admin role inside.
grant execute on function
  public.set_store_settings(double precision, double precision, uuid, integer),
  public.admin_config_overview()
to authenticated;
