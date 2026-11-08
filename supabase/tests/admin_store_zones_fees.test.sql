-- Tests for the admin panel, part D-2a: store settings, zones and fee rules
-- (plan step 17d-2a, D-058). Run with `npm run db:test`. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('d5000000-0000-4000-8000-000000000001', 'admin17d2@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}'),
  ('d5000000-0000-4000-8000-000000000002', 'caja17d2@test.local', 'authenticated', 'authenticated', '{"staff_role":"cashier"}');

create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"d5000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"staff_role":"admin"}}', true);
$$;
create function pg_temp.as_cashier() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"d5000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"staff_role":"cashier"}}', true);
$$;
create function pg_temp.zone(p_name text) returns uuid language sql as $$
  select id from public.delivery_zones where municipality = p_name;
$$;
-- Rows a cashier's direct update of a fee rule reaches (RLS: admin only).
create function pg_temp.cashier_fee_update() returns integer language plpgsql as $$
declare n integer;
begin
  update public.delivery_fee_rules set fee_cop = 1 where name = 'Hasta 1 km';
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

create temporary table t_before as
  select private.distance_from_store_m(private.make_point(6.17, -75.59)) as distance_m;
grant select on t_before to authenticated;

-- ---------------------------------------------------------------------------
-- Store settings
-- ---------------------------------------------------------------------------

select pg_temp.as_cashier();
set local role authenticated;
select throws_ok(
  format($$select public.set_store_settings(6.17, -75.59, %L, 20000)$$, pg_temp.zone('Envigado')),
  '42501', 'admin_forbidden', 'store: a cashier cannot change it'
);
select throws_ok($$select public.admin_config_overview()$$, '42501', 'admin_forbidden',
  'overview: a cashier cannot read it');
select is(pg_temp.cashier_fee_update(), 0, 'fees: a cashier cannot change a fee rule');

reset role;
select pg_temp.as_admin();
set local role authenticated;
select is(public.set_store_settings(4.71, -74.07, pg_temp.zone('Envigado'), 20000) ->> 'error',
  'location_outside_valley', 'store: a point outside Antioquia (Bogotá) is rejected');
select is(public.set_store_settings(7.88, -76.63, pg_temp.zone('Envigado'), 20000) ->> 'error',
  'location_outside_valley', 'store: a point in Antioquia but outside the Valle de Aburrá (Apartadó) is rejected');
select is(public.set_store_settings(6.17, -75.59, gen_random_uuid(), 20000) ->> 'error',
  'unknown_zone', 'store: an unknown municipality is rejected');
select is(public.set_store_settings(6.17, -75.59, pg_temp.zone('Envigado'), 500) ->> 'error',
  'invalid_max_distance', 'store: a radius under 1 km is rejected');
select is(public.set_store_settings(6.17, -75.59, pg_temp.zone('Envigado'), 20000),
  '{"ok": true, "changed": true}'::jsonb, 'store: the admin saves location, municipality and radius');
select is(public.set_store_settings(6.17, -75.59, pg_temp.zone('Envigado'), 20000),
  '{"ok": true, "changed": false}'::jsonb, 'store: saving the same values changes nothing');
select throws_ok($$update public.app_settings set value = '1'::jsonb where key = 'delivery_max_distance_m'$$,
  '42501', null, 'settings: no direct writes, only through the function');

reset role;
select results_eq(
  $$select (select value from public.app_settings where key = 'store_location'),
           (select (value #>> '{}')::uuid from public.app_settings where key = 'store_zone_id'),
           private.setting_integer('delivery_max_distance_m', 0),
           private.store_zone_id()$$,
  $$select '{"lat": 6.17, "lng": -75.59}'::jsonb, pg_temp.zone('Envigado'), 20000, pg_temp.zone('Envigado')$$,
  'store: the settings are stored in the shape checkout and sales blocks read'
);
select isnt(private.distance_from_store_m(private.make_point(6.17, -75.59)), (select distance_m from t_before),
  'store: delivery distances are measured from the new location');
select is(private.distance_from_store_m(private.make_point(6.17, -75.59)), 0,
  'store: a delivery at the store point is 0 m away');
select is(
  (select count(*)::int from public.config_changes
   where table_name = 'app_settings' and changed_by = 'd5000000-0000-4000-8000-000000000001'),
  3, 'history: the three settings changes are recorded with who made them'
);

-- ---------------------------------------------------------------------------
-- Zones
-- ---------------------------------------------------------------------------

select pg_temp.as_admin();
set local role authenticated;
update public.delivery_zones set is_active = false where municipality = 'Barbosa';
select throws_ok($$update public.delivery_zones set municipality = 'Otra' where municipality = 'Bello'$$,
  '42501', null, 'zones: the name cannot change');
select throws_ok($$insert into public.delivery_zones (municipality, dane_code) values ('Rionegro', '05615')$$,
  '42501', null, 'zones: no new municipalities');
select throws_ok($$delete from public.delivery_zones where municipality = 'Bello'$$,
  '42501', null, 'zones: none is deleted');
reset role;
select is((select is_active from public.delivery_zones where municipality = 'Barbosa'), false,
  'zones: the admin deactivates one');
select is(
  (select new_row ->> 'is_active' from public.config_changes
   where table_name = 'delivery_zones' and row_id = pg_temp.zone('Barbosa')::text),
  'false', 'history: the zone change is recorded'
);

-- ---------------------------------------------------------------------------
-- Fee rules
-- ---------------------------------------------------------------------------

select pg_temp.as_admin();
set local role authenticated;
update public.delivery_fee_rules set fee_cop = 7000, max_distance_m = 1500 where name = 'Hasta 1 km';
insert into public.delivery_fee_rules (name, customer_type, min_boxes, max_distance_m, fee_cop)
  values ('Mayorista cerca', 'wholesale', 5, 2000, 3000);
select throws_ok($$delete from public.delivery_fee_rules where name = 'Más de 1 km'$$,
  '42501', null, 'fees: a fee rule is never deleted');
select throws_ok($$update public.delivery_fee_rules set id = gen_random_uuid() where name = 'Más de 1 km'$$,
  '42501', null, 'fees: the id cannot change (it is the history key)');
select throws_ok($$insert into public.delivery_fee_rules (name, customer_type, min_boxes, fee_cop) values ('Minorista caja', 'retail', 2, 1000)$$,
  '23514', null, 'fees: a retail rule with minimum boxes (it would never apply) is rejected');
select throws_ok($$update public.delivery_fee_rules set fee_cop = 5000000 where name = 'Más de 1 km'$$,
  '23514', null, 'fees: a fee above $ 1.000.000 is rejected');
reset role;
select results_eq(
  $$select fee_cop, max_distance_m from public.delivery_fee_rules where name = 'Hasta 1 km'$$,
  $$values (7000::bigint, 1500)$$, 'fees: the admin edits a fee rule'
);
select is(
  (select count(*)::int from public.config_changes where table_name = 'delivery_fee_rules'),
  2, 'history: the edit and the new fee rule are recorded'
);

-- ---------------------------------------------------------------------------
-- Overview
-- ---------------------------------------------------------------------------

select pg_temp.as_admin();
set local role authenticated;
select is(jsonb_array_length(public.admin_config_overview() -> 'zones'), 10, 'overview: the ten municipalities');
select is(public.admin_config_overview() #>> '{store,zone_id}', pg_temp.zone('Envigado')::text,
  'overview: the store municipality');
select ok(
  (select bool_or(c ->> 'changed_by' = 'admin17d2@test.local')
   from jsonb_array_elements(public.admin_config_overview() -> 'changes') c),
  'overview: the recent changes with who made them'
);

reset role;
select * from finish();
rollback;
