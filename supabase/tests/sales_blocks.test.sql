-- Tests for sales blocks (plan step 15, D-051). Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('f0000000-0000-4000-8000-000000000001', 'sb1@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('f0000000-0000-4000-8000-000000000021', 'sba@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}');
insert into public.customers (id, customer_type, wholesale_status, full_name) values
  ('f0000000-0000-4000-8000-000000000001', 'retail', null, 'Cliente Bloqueo');

create function pg_temp.zone(p text) returns uuid language sql as $$
  select id from public.delivery_zones where municipality = p;
$$;
insert into public.customer_addresses (id, customer_id, label, address_line, zone_id, location) values
  ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'Bello', 'Calle de prueba 1',
   pg_temp.zone('Bello'), extensions.st_project(private.store_location(), 5000, 0));

create function pg_temp.as_customer() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"f0000000-0000-4000-8000-000000000021","role":"authenticated","app_metadata":{"staff_role":"admin"}}', true);
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Bogotá is UTC-5 all year (no daylight saving).
create function pg_temp.bog(p text) returns timestamptz language sql as $$
  select (p::timestamp) at time zone 'America/Bogota';
$$;

-- ---------------------------------------------------------------------------
-- Who can write
-- ---------------------------------------------------------------------------

select is(private.store_zone_id(), pg_temp.zone('Medellín'), 'store: the store municipality is Medellín (assumption)');

select pg_temp.as_customer();
set local role authenticated;
select throws_ok(
  $$insert into public.sales_blocks (name, kind, starts_at, ends_at, message)
    values ('x', 'date_range', now(), now() + interval '1 hour', 'Mensaje')$$,
  '42501', null, 'rules: a customer cannot create them'
);
reset role;

select pg_temp.as_admin();
-- Inserted as the table owner with the admin's session in the claims, so
-- these fixtures can keep fixed ids: since D-060 the admin cannot choose the
-- id through the API (admin_sales_blocks.test.sql covers the admin's writes).
-- created_by still comes from the session.
-- Weekly window that crosses midnight, every day, Medellín only, web and POS.
insert into public.sales_blocks (id, name, kind, zone_id, weekdays, start_time, end_time, message) values
  ('f1000000-0000-4000-8000-000000000001', 'Horario nocturno', 'weekly', pg_temp.zone('Medellín'),
   array[1, 2, 3, 4, 5, 6, 7]::smallint[], '22:00', '10:00', 'En Medellín no vendemos de 10:00 p. m. a 10:00 a. m.');
-- Weekly window on Saturdays only, web only, global.
insert into public.sales_blocks (id, name, kind, channels, weekdays, start_time, end_time, message) values
  ('f1000000-0000-4000-8000-000000000002', 'Sábado web', 'weekly', array['web'],
   array[6]::smallint[], '14:00', '16:00', 'Los sábados de 2:00 a 4:00 p. m. la tienda web no vende.');
reset role;

select is(
  (select created_by from public.sales_blocks where id = 'f1000000-0000-4000-8000-000000000001'),
  'f0000000-0000-4000-8000-000000000021'::uuid, 'rules: created_by comes from the session'
);
select is((select count(*)::int from public.sales_block_changes), 2, 'history: each insert is logged');
select throws_ok(
  $$insert into public.sales_blocks (name, kind, weekdays, start_time, end_time, message)
    values ('x', 'weekly', array[8]::smallint[], '10:00', '11:00', 'Mensaje')$$,
  '23514', null, 'rules: invalid weekday is rejected'
);
select throws_ok(
  $$insert into public.sales_blocks (name, kind, starts_at, message) values ('x', 'date_range', now(), 'Mensaje')$$,
  '23514', null, 'rules: a date range needs its end'
);

-- ---------------------------------------------------------------------------
-- Evaluation (fixed moments; 2026-11-07 is a Saturday)
-- ---------------------------------------------------------------------------

create function pg_temp.at(p_channel text, p_zone text, p_local text) returns text language sql as $$
  select private.sales_block_at(p_channel, pg_temp.zone(p_zone), pg_temp.bog(p_local)) ->> 'name';
$$;
create function pg_temp.until(p_channel text, p_zone text, p_local text) returns timestamp language sql as $$
  select ((private.sales_block_at(p_channel, pg_temp.zone(p_zone), pg_temp.bog(p_local)) ->> 'ends_at')::timestamptz)
         at time zone 'America/Bogota';
$$;

select is(pg_temp.at('web', 'Medellín', '2026-11-05 23:30'), 'Horario nocturno', 'weekly: blocked at 23:30');
select is(pg_temp.until('web', 'Medellín', '2026-11-05 23:30'), '2026-11-06 10:00'::timestamp, 'weekly: until 10:00 next day');
select is(pg_temp.at('web', 'Medellín', '2026-11-06 09:59'), 'Horario nocturno', 'weekly: still blocked at 09:59 after midnight');
select is(pg_temp.until('web', 'Medellín', '2026-11-06 09:59'), '2026-11-06 10:00'::timestamp, 'weekly: until 10:00 the same day');
select is(pg_temp.at('web', 'Medellín', '2026-11-06 10:00'), null, 'weekly: open at 10:00 sharp');
select is(pg_temp.at('pos', 'Medellín', '2026-11-05 23:30'), 'Horario nocturno', 'channel: the POS is blocked too');
select is(pg_temp.at('web', 'Bello', '2026-11-05 23:30'), null, 'municipality: another municipality is not blocked');
select is(pg_temp.at('web', 'Bello', '2026-11-07 15:00'), 'Sábado web', 'global: blocks every municipality');
select is(pg_temp.at('pos', 'Bello', '2026-11-07 15:00'), null, 'channel: a web-only rule does not block the POS');
select is(pg_temp.at('web', 'Bello', '2026-11-08 15:00'), null, 'weekly: only on its weekdays');

update public.sales_blocks set is_active = false where id = 'f1000000-0000-4000-8000-000000000002';
select is(pg_temp.at('web', 'Bello', '2026-11-07 15:00'), null, 'rules: an inactive rule does not block');

-- Date range with validity limiting a weekly rule.
update public.sales_blocks set ends_at = pg_temp.bog('2026-11-06 08:00') where id = 'f1000000-0000-4000-8000-000000000001';
select is(pg_temp.until('web', 'Medellín', '2026-11-06 07:00'), '2026-11-06 08:00'::timestamp, 'weekly: ends with the rule validity');
select is(pg_temp.at('web', 'Medellín', '2026-11-06 23:00'), null, 'weekly: no longer blocks after the validity');
delete from public.sales_blocks where id = 'f1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.sales_block_changes where operation = 'delete'), 1, 'history: deletes are logged too');

-- ---------------------------------------------------------------------------
-- Enforcement: dry law in Medellín right now
-- ---------------------------------------------------------------------------

insert into public.sales_blocks (id, name, kind, zone_id, starts_at, ends_at, message) values
  ('f1000000-0000-4000-8000-000000000003', 'Ley seca', 'date_range', pg_temp.zone('Medellín'),
   now() - interval '1 hour', now() + interval '1 hour', 'Ley seca en Medellín por elecciones.');

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is(public.get_sales_block() ->> 'name', 'Ley seca', 'notice: a visitor sees the store municipality block');
reset role;

select pg_temp.as_customer();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
select is(
  public.place_order('f3000000-0000-4000-8000-000000000001') #>> '{block,message}',
  'Ley seca en Medellín por elecciones.', 'order: pickup uses the store municipality and is blocked'
);
select is((select count(*)::int from public.orders), 0, 'order: nothing was created');
select is(jsonb_array_length(public.get_cart_items()), 1, 'order: the cart is kept');
select is(
  public.place_order('f3000000-0000-4000-8000-000000000002', 'delivery', 'f2000000-0000-4000-8000-000000000001') ->> 'ok',
  'true', 'order: delivery to Bello is not blocked by Medellín''s rule'
);
reset role;

select is(
  (select sale_zone_id from public.orders limit 1), pg_temp.zone('Bello'),
  'order: the municipality comes from the address snapshot'
);

-- The block now covers Bello too (it starts between ordering and paying).
update public.sales_blocks set zone_id = null where id = 'f1000000-0000-4000-8000-000000000003';
select pg_temp.as_customer();
set local role authenticated;
select is(
  public.start_payment((select id from public.orders limit 1), 'f4000000-0000-4000-8000-000000000001') ->> 'error',
  'sales_blocked', 'payment: no new payment while the block applies'
);
reset role;

-- The POS is blocked by the trigger as well (step 16 inserts POS orders).
select throws_ok(
  $$insert into public.orders (channel, fulfillment, sale_unit, subtotal_cop, total_cop, total_base_units, idempotency_key)
    values ('pos', 'pickup', 'unit', 1000, 1000, 1, gen_random_uuid())$$,
  '22023', 'sales_blocked', 'pos: an order is rejected while the block applies'
);

update public.sales_blocks set ends_at = now() - interval '1 minute', starts_at = now() - interval '2 hours'
where id = 'f1000000-0000-4000-8000-000000000003';
select pg_temp.as_customer();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
select is(
  public.place_order('f3000000-0000-4000-8000-000000000001') ->> 'ok',
  'true', 'order: once the block ends, the same cart can be ordered'
);
reset role;

select pg_temp.as_customer();
set local role authenticated;
select is_empty($$select * from public.sales_block_changes$$, 'history: a customer cannot read it');
select is_empty($$select * from public.sales_blocks$$, 'rules: a customer cannot read the table (no staff ids)');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select * from public.sales_blocks$$, '42501', null, 'rules: a visitor has no access to the table');
reset role;

select ok(
  not has_table_privilege('authenticated', 'public.sales_block_changes', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.sales_blocks', 'TRUNCATE'),
  'grants: no TRUNCATE on the rules or their history'
);

select * from finish();
rollback;
