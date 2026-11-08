-- Tests for the admin panel, part D-1: POS voids and deliveries (plan step 17d-1, D-057).
-- Run with `npm run db:test`. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('d1000000-0000-4000-8000-000000000001', 'admin17d@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}'),
  ('d1000000-0000-4000-8000-000000000002', 'caja17d@test.local', 'authenticated', 'authenticated', '{"staff_role":"cashier"}'),
  ('d1000000-0000-4000-8000-000000000003', 'moto17d@test.local', 'authenticated', 'authenticated', '{"staff_role":"courier"}'),
  ('d1000000-0000-4000-8000-000000000004', 'cliente17d@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');
insert into public.customers (id, customer_type, full_name) values
  ('d1000000-0000-4000-8000-000000000004', 'retail', 'Cliente 17d');
insert into public.couriers (id, provider_id, full_name)
  select 'd1000000-0000-4000-8000-000000000003', id, 'Moto 17d' from public.delivery_providers where kind = 'own';

create function pg_temp.as_user(p_id text, p_meta text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":' || p_meta || '}', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.as_user('d1000000-0000-4000-8000-000000000001', '{"staff_role":"admin"}');
$$;
create function pg_temp.as_cashier() returns void language sql as $$
  select pg_temp.as_user('d1000000-0000-4000-8000-000000000002', '{"staff_role":"cashier"}');
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- A POS sale (card, one aguardiente) and two paid web delivery orders.
insert into public.orders (id, customer_id, channel, status, fulfillment, sale_unit, subtotal_cop, total_cop,
  total_base_units, idempotency_key, paid_at, delivered_at, cashier_id, pos_payment_method, age_confirmed)
values ('d2000000-0000-4000-8000-000000000001', null, 'pos', 'delivered', 'pickup', 'unit', 45000, 45000,
  1, gen_random_uuid(), now(), now(), 'd1000000-0000-4000-8000-000000000002', 'card', true);
insert into public.order_items (order_id, product_id, sku, product_name, sale_unit, units_per_box, quantity, unit_price_cop, line_total_cop, base_units)
values ('d2000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'NAC-AGU-750', 'Aguardiente', 'unit', 12, 1, 45000, 45000, 1);

create function pg_temp.delivery_order(p_id uuid, p_paid_minutes_ago integer) returns void language plpgsql as $$
begin
  insert into public.orders (id, customer_id, channel, status, fulfillment, sale_unit, subtotal_cop, delivery_fee_cop,
    total_cop, total_base_units, idempotency_key, delivery_address, delivery_distance_m)
  values (p_id, 'd1000000-0000-4000-8000-000000000004', 'web', 'awaiting_payment', 'delivery', 'unit', 45000, 6000,
    51000, 1, gen_random_uuid(),
    jsonb_build_object('municipality', 'Medellín', 'address_line', 'Calle 10 # 43-20', 'contact_name', 'Cliente 17d',
                       'contact_phone', '3001234567', 'lat', 6.25, 'lng', -75.57),
    948);
  update public.orders set status = 'paid', paid_at = now() - make_interval(mins => p_paid_minutes_ago) where id = p_id;
end $$;
select pg_temp.delivery_order('d2000000-0000-4000-8000-000000000011', 30);
select pg_temp.delivery_order('d2000000-0000-4000-8000-000000000012', 60);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

select pg_temp.as_cashier();
set local role authenticated;
select throws_ok($$select public.admin_list_pos_sales()$$, '42501', 'admin_forbidden', 'pos list: a cashier cannot read it');
select throws_ok($$select public.admin_list_deliveries()$$, '42501', 'admin_forbidden', 'deliveries: a cashier cannot read them');
select throws_ok($$select public.admin_list_delivery_options()$$, '42501', 'admin_forbidden', 'options: a cashier cannot read them');
select is((select count(*)::int from public.config_changes), 0, 'history: a cashier reads nothing');
reset role;
set local role anon;
select throws_ok($$select public.admin_list_deliveries()$$, '42501', null, 'deliveries: a visitor cannot call it');
reset role;

-- ---------------------------------------------------------------------------
-- POS sales
-- ---------------------------------------------------------------------------

select pg_temp.as_admin();
set local role authenticated;
select is(
  (select s ->> 'cashier' from jsonb_array_elements(public.admin_list_pos_sales()) s
   where s ->> 'order_id' = 'd2000000-0000-4000-8000-000000000001'),
  'caja17d@test.local', 'pos list: shows who sold it'
);
select is(
  (select (s ->> 'units')::int from jsonb_array_elements(public.admin_list_pos_sales()) s
   where s ->> 'order_id' = 'd2000000-0000-4000-8000-000000000001'),
  1, 'pos list: shows the bottles sold'
);
select is(jsonb_array_length(public.admin_list_pos_sales(1)), 1, 'pos list: the limit is respected');

select is(
  public.void_pos_sale('d2000000-0000-4000-8000-000000000001', 'Cliente devolvió la botella') ->> 'ok', 'true',
  'pos list: the admin voids a sale'
);
select results_eq(
  $$select s ->> 'status', s ->> 'void_reason', s ->> 'voided_by' from jsonb_array_elements(public.admin_list_pos_sales()) s
    where s ->> 'order_id' = 'd2000000-0000-4000-8000-000000000001'$$,
  $$values ('refunded', 'Cliente devolvió la botella', 'admin17d@test.local')$$,
  'pos list: the void shows its reason and who did it'
);

-- A rejected invoice of a voided sale can never be retried: it must not stay
-- as an alert in the invoices page nor in the summary.
reset role;
insert into public.invoices (order_id, reference_code, status, customer, payment_method_code,
  total_cop, iva_cop, participation_cop, exploitation_cop, base_cop)
values ('d2000000-0000-4000-8000-000000000001', 'INV-17D-VOID', 'rejected', '{}'::jsonb, '48', 45000, 0, 0, 0, 45000);
select pg_temp.as_admin();
set local role authenticated;
select is(
  (select count(*)::int from jsonb_array_elements(public.admin_list_invoices() -> 'invoices') i
   where i ->> 'reference_code' = 'INV-17D-VOID'),
  0, 'invoices: a voided sale leaves no invoice alert'
);
select is(
  (public.admin_summary() ->> 'invoices_attention')::int,
  jsonb_array_length(public.admin_list_invoices() -> 'invoices')
    + (select count(*)::int from jsonb_array_elements(public.admin_list_invoices() -> 'credit_notes') n
       where n ->> 'status' = 'rejected' or n ->> 'action_status' = 'failed'),
  'summary: invoices to look at use the same criterion as the invoices page'
);

-- ---------------------------------------------------------------------------
-- Deliveries
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(d ->> 'order_id') from jsonb_array_elements(public.admin_list_deliveries()) d
   where d ->> 'order_id' like 'd2000000%'),
  array['d2000000-0000-4000-8000-000000000012', 'd2000000-0000-4000-8000-000000000011'],
  'deliveries: paid orders waiting, oldest payment first'
);
select is(
  (select d ->> 'municipality' || ' · ' || (d ->> 'contact_phone') from jsonb_array_elements(public.admin_list_deliveries()) d
   where d ->> 'order_id' = 'd2000000-0000-4000-8000-000000000011'),
  'Medellín · 3001234567', 'deliveries: show the address snapshot and contact'
);
select is(
  (select (public.admin_summary() ->> 'deliveries_to_assign')::int) >= 2, true,
  'summary: counts deliveries to assign'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.admin_list_delivery_options() -> 'couriers') c
   where c ->> 'id' = 'd1000000-0000-4000-8000-000000000003'),
  1, 'options: the active own courier is offered'
);

select lives_ok(
  $$select public.assign_delivery('d2000000-0000-4000-8000-000000000012',
      (select id from public.delivery_providers where kind = 'own'), 'd1000000-0000-4000-8000-000000000003')$$,
  'deliveries: the admin assigns an own courier'
);
select results_eq(
  $$select d ->> 'status', d ->> 'courier' from jsonb_array_elements(public.admin_list_deliveries()) d
    where d ->> 'order_id' = 'd2000000-0000-4000-8000-000000000012'$$,
  $$values ('out_for_delivery', 'Moto 17d')$$,
  'deliveries: the assigned order shows its courier, after the unassigned ones'
);

-- A failed attempt is shown and counted.
reset role;
insert into public.delivery_attempts (order_id, actor_id, outcome, failure_reason, notes, idempotency_key)
values ('d2000000-0000-4000-8000-000000000012', 'd1000000-0000-4000-8000-000000000003', 'failed',
        'recipient_absent', 'Nadie en casa', gen_random_uuid());
select pg_temp.as_admin();
set local role authenticated;
select is(
  (select d #>> '{last_failure,reason}' from jsonb_array_elements(public.admin_list_deliveries()) d
   where d ->> 'order_id' = 'd2000000-0000-4000-8000-000000000012'),
  'recipient_absent', 'deliveries: the last failed attempt is shown'
);
select is((public.admin_summary() ->> 'deliveries_failed')::int >= 1, true, 'summary: counts failed deliveries');
create temporary table t_failed as select (public.admin_summary() ->> 'deliveries_failed')::int as n;

-- Reassigning starts over: the failure of the previous assignment is no
-- longer shown nor counted. (Inside this test transaction now() does not
-- move, so the later reassignment time is set by hand.)
select public.assign_delivery('d2000000-0000-4000-8000-000000000012',
  (select id from public.delivery_providers where kind = 'own'), 'd1000000-0000-4000-8000-000000000003');
reset role;
update public.orders set assigned_at = now() + interval '1 minute' where id = 'd2000000-0000-4000-8000-000000000012';
select pg_temp.as_admin();
set local role authenticated;
select is(
  (select d -> 'last_failure' from jsonb_array_elements(public.admin_list_deliveries()) d
   where d ->> 'order_id' = 'd2000000-0000-4000-8000-000000000012'),
  'null'::jsonb, 'deliveries: a reassigned order no longer shows the old failure'
);
select is((public.admin_summary() ->> 'deliveries_failed')::int, (select n - 1 from t_failed),
  'summary: a reassigned order is no longer counted as failed');

-- ---------------------------------------------------------------------------
-- Third-party providers and their history
-- ---------------------------------------------------------------------------

insert into public.delivery_providers (id, name, kind) values
  ('d3000000-0000-4000-8000-000000000001', 'Mensajería Rápida 17d', 'third_party');
update public.delivery_providers set is_active = false where id = 'd3000000-0000-4000-8000-000000000001';
update public.delivery_providers set is_active = false where id = 'd3000000-0000-4000-8000-000000000001';
select results_eq(
  $$select operation, new_row ->> 'is_active', changed_by from public.config_changes
    where table_name = 'delivery_providers' and row_id = 'd3000000-0000-4000-8000-000000000001' order by created_at, operation$$,
  $$values ('INSERT', 'true', 'd1000000-0000-4000-8000-000000000001'::uuid),
           ('UPDATE', 'false', 'd1000000-0000-4000-8000-000000000001'::uuid)$$,
  'history: creating and deactivating a provider is recorded once each, with who did it'
);
select is(
  (select p ->> 'is_active' from jsonb_array_elements(public.admin_list_delivery_options() -> 'providers') p
   where p ->> 'id' = 'd3000000-0000-4000-8000-000000000001'),
  'false', 'options: inactive providers are still listed'
);
select throws_ok(
  $$insert into public.config_changes (table_name, row_id, operation) values ('x', 'y', 'INSERT')$$,
  '42501', null, 'history: nobody writes it directly'
);
select throws_ok(
  $$insert into public.delivery_providers (name, kind) values (' mensajería rápida 17D ', 'third_party')$$,
  '23505', null, 'providers: names are unique ignoring case and spaces'
);
select throws_ok(
  $$insert into public.delivery_providers (name, kind) values ('Otros propios', 'own')$$,
  '42501', null, 'providers: the admin cannot create another own-couriers provider'
);
update public.delivery_providers set is_active = false where kind = 'own';
select is(
  (select is_active from public.delivery_providers where kind = 'own'),
  true, 'providers: the own-couriers provider cannot be deactivated'
);

reset role;
select pg_temp.as_cashier();
set local role authenticated;
select throws_ok(
  $$insert into public.delivery_providers (name, kind) values ('Intruso', 'third_party')$$,
  '42501', null, 'providers: a cashier cannot create one'
);
reset role;
select throws_ok(
  $$update public.config_changes set operation = 'DELETE'$$, null, null,
  'history: insert-only, even for postgres'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.config_changes'::regclass),
  'history: RLS is enabled'
);

select * from finish();
rollback;
