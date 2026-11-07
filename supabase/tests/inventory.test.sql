-- Tests for the inventory ledger, balance and reservations (plan step 10, D-038).
-- Run with `npm run db:test`. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- P and P2: national products with a retail price, so they are in the catalog.
insert into public.products (id, sku, name, origin, units_per_box, allow_retail_by_unit) values
  ('90000000-0000-4000-8000-000000000001', 'INV-P',  'P',  'national', 6, true),
  ('90000000-0000-4000-8000-000000000002', 'INV-P2', 'P2', 'national', 6, true);
insert into public.product_prices (price_list_id, product_id, price_cop) values
  ((select id from public.price_lists where customer_type = 'retail' and is_default), '90000000-0000-4000-8000-000000000001', 1000),
  ((select id from public.price_lists where customer_type = 'retail' and is_default), '90000000-0000-4000-8000-000000000002', 1000);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('91000000-0000-4000-8000-000000000001', 'bodega@test.local', 'authenticated', 'authenticated', '{"staff_role":"warehouse"}'),
  ('91000000-0000-4000-8000-000000000002', 'cli@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('91000000-0000-4000-8000-000000000003', 'caja@test.local', 'authenticated', 'authenticated', '{"staff_role":"cashier"}');

create function pg_temp.stock(p uuid) returns text language sql as $$
  select on_hand || '/' || reserved from public.product_stock where product_id = p;
$$;

-- ---------------------------------------------------------------------------
-- Warehouse staff
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"staff_role":"warehouse"}}', true);
set local role authenticated;

create temporary table t_entry as
  select public.record_stock_entry('90000000-0000-4000-8000-000000000001', 10, 'FC-001',
    'a0000000-0000-4000-8000-000000000001') as id;
select public.record_stock_entry('90000000-0000-4000-8000-000000000002', 5, 'FC-002',
  'a0000000-0000-4000-8000-000000000002');

reset role;
select is(pg_temp.stock('90000000-0000-4000-8000-000000000001'), '10/0', 'entry: goods received add stock');
set local role authenticated;

select is(
  public.record_stock_entry('90000000-0000-4000-8000-000000000001', 10, 'FC-001',
    'a0000000-0000-4000-8000-000000000001'),
  (select id from t_entry),
  'entry: the same idempotency key returns the same movement'
);
reset role;
select is(pg_temp.stock('90000000-0000-4000-8000-000000000001'), '10/0', 'entry: a retry does not add stock twice');
set local role authenticated;

select throws_ok(
  $$select public.record_stock_entry('90000000-0000-4000-8000-000000000001', 3, ' ', gen_random_uuid())$$,
  '22023', 'inventory_missing_reference', 'entry: the purchase document is required'
);
select throws_ok(
  $$select public.record_waste('90000000-0000-4000-8000-000000000001', 2, '', gen_random_uuid())$$,
  '22023', 'inventory_missing_reason', 'waste: the reason is required'
);
select public.record_waste('90000000-0000-4000-8000-000000000001', 2, 'Botellas rotas', gen_random_uuid());
select public.record_count('90000000-0000-4000-8000-000000000001', 7, 'Conteo semanal', gen_random_uuid());
reset role;
select is(pg_temp.stock('90000000-0000-4000-8000-000000000001'), '7/0', 'count: waste 2, then a count of 7 records -1 as adjustment');
set local role authenticated;
select is(
  public.record_count('90000000-0000-4000-8000-000000000001', 7, 'Conteo semanal', gen_random_uuid()),
  null,
  'count: no difference, no movement'
);
select throws_ok(
  $$select public.record_waste('90000000-0000-4000-8000-000000000001', 50, 'Rotura', gen_random_uuid())$$,
  '22023', 'inventory_insufficient_stock', 'waste: cannot take more than is available'
);

reset role;

-- ---------------------------------------------------------------------------
-- Customers and cashiers cannot change stock
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
set local role authenticated;
select throws_ok(
  $$select public.record_stock_entry('90000000-0000-4000-8000-000000000001', 100, 'X', gen_random_uuid())$$,
  '42501', 'inventory_forbidden', 'customer: cannot add stock'
);
select is_empty($$select * from public.product_stock$$, 'customer: cannot read stock balances');
select throws_ok(
  $$select * from public.reserve_stock('x', '[{"product_id":"90000000-0000-4000-8000-000000000001","units":1}]')$$,
  '42501', null, 'customer: cannot reserve stock directly'
);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"staff_role":"cashier"}}', true);
set local role authenticated;
select throws_ok(
  $$select public.record_waste('90000000-0000-4000-8000-000000000001', 1, 'X', gen_random_uuid())$$,
  '42501', 'inventory_forbidden', 'cashier: cannot record waste'
);
select is(
  (select on_hand from public.product_stock where product_id = '90000000-0000-4000-8000-000000000001'),
  7, 'cashier: can read the real stock'
);
reset role;

-- ---------------------------------------------------------------------------
-- Reservations (server)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select is(
  (select count(*)::int from public.reserve_stock('order-1',
    '[{"product_id":"90000000-0000-4000-8000-000000000001","units":5}]')),
  1, 'reserve: reserves the units of a pending web order'
);
select throws_ok(
  $$select * from public.reserve_stock('order-2', '[
      {"product_id":"90000000-0000-4000-8000-000000000002","units":1},
      {"product_id":"90000000-0000-4000-8000-000000000001","units":3}]')$$,
  '22023', 'inventory_insufficient_stock', 'reserve: fails when one product has not enough'
);
reset role;
select is(pg_temp.stock('90000000-0000-4000-8000-000000000002'), '5/0', 'reserve: all or nothing, the other product stays free');

-- The POS cannot sell reserved units (available = 7 - 5 = 2).
select throws_ok(
  $$insert into public.inventory_movements (product_id, movement_type, units, reference)
    values ('90000000-0000-4000-8000-000000000001', 'pos_sale', -3, 'pos-1')$$,
  '23514', null, 'pos: cannot sell units reserved for a web order'
);
select lives_ok(
  $$insert into public.inventory_movements (product_id, movement_type, units, reference)
    values ('90000000-0000-4000-8000-000000000001', 'pos_sale', -2, 'pos-1')$$,
  'pos: can sell the available units'
);

-- Web safety stock: P2 has 5 units and a buffer of 1, so the web can take 4.
update public.products set web_safety_stock = 1 where id = '90000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok(
  $$select * from public.reserve_stock('order-3', '[{"product_id":"90000000-0000-4000-8000-000000000002","units":5}]')$$,
  '22023', 'inventory_insufficient_stock', 'web: the safety stock is not sold online'
);
select is(
  (select count(*)::int from public.reserve_stock('order-3',
    '[{"product_id":"90000000-0000-4000-8000-000000000002","units":4}]')),
  1, 'web: up to the available minus the safety stock'
);
reset role;

-- Expiry: order-3 expires and the cron job releases it.
update public.stock_reservations set expires_at = now() - interval '1 minute' where reference = 'order-3';
select is(public.release_expired_reservations(), 1, 'expiry: the expired reservation is released');
select is(pg_temp.stock('90000000-0000-4000-8000-000000000002'), '5/0', 'expiry: the units are free again');

-- Payment approved for order-1: reservation becomes a web sale.
set local role service_role;
select is(
  public.consume_reservation('order-1', '[{"product_id":"90000000-0000-4000-8000-000000000001","units":5}]',
    'b0000000-0000-4000-8000-000000000001'),
  1, 'consume: the paid order is sold'
);
select is(
  public.consume_reservation('order-1', '[{"product_id":"90000000-0000-4000-8000-000000000001","units":5}]',
    'b0000000-0000-4000-8000-000000000001'),
  0, 'consume: a repeated webhook does not sell twice'
);
reset role;
select is(pg_temp.stock('90000000-0000-4000-8000-000000000001'), '0/0', 'consume: 7 - 2 (POS) - 5 (web) = 0, nothing reserved');

-- ---------------------------------------------------------------------------
-- Ledger integrity and reads
-- ---------------------------------------------------------------------------

select throws_ok(
  $$update public.inventory_movements set units = 100 where reference = 'FC-001'$$,
  '42501', null, 'ledger: movements cannot be edited, not even by postgres'
);
select is_empty($$select * from public.reconcile_stock()$$, 'ledger: every balance matches the sum of its movements');

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is(
  (select available_units from public.get_web_availability() where product_id = '90000000-0000-4000-8000-000000000002'),
  4, 'availability: the web shows the stock minus the safety stock'
);
reset role;

select * from finish();
rollback;
