-- Tests for the cart and web orders (plan step 11, D-039).
-- Uses the sample products and stock of seed.sql. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Seed products: 101 aguardiente (retail min 1, 12 per box, 120 units, web
-- safety stock 2), 103 cerveza (retail min 6), 201 whisky (imported).
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('c0000000-0000-4000-8000-000000000001', 'r1@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('c0000000-0000-4000-8000-000000000002', 'r2@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('c0000000-0000-4000-8000-000000000003', 'w1@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');
insert into public.customers (id, customer_type, wholesale_status, full_name) values
  ('c0000000-0000-4000-8000-000000000001', 'retail', null, 'R1'),
  ('c0000000-0000-4000-8000-000000000002', 'retail', null, 'R2'),
  ('c0000000-0000-4000-8000-000000000003', 'wholesale', 'approved', 'W1');

create function pg_temp.as_r1() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
$$;
create function pg_temp.as_r2() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
$$;
create function pg_temp.as_w1() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"customer_type":"wholesale","wholesale_approved":true}}', true);
$$;
create function pg_temp.reserved(p uuid) returns integer language sql as $$
  select reserved from public.product_stock where product_id = p;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Cart
-- ---------------------------------------------------------------------------

select pg_temp.as_r1();
set local role authenticated;

select lives_ok($$select public.set_cart_item('00000000-0000-4000-8000-000000000101', 2)$$, 'cart: add a product');
select lives_ok($$select public.set_cart_item('00000000-0000-4000-8000-000000000103', 6)$$, 'cart: add another product');
select is(jsonb_array_length(public.get_cart_items()), 2, 'cart: the customer sees their two lines');
select throws_ok(
  $$select public.set_cart_item('00000000-0000-4000-8000-000000000101', -1)$$,
  '22023', 'cart_invalid_quantity', 'cart: a negative quantity is rejected'
);
reset role;

select pg_temp.as_r2();
set local role authenticated;
select is_empty($$select * from public.cart_items$$, 'cart: another customer cannot see it');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select public.set_cart_item('00000000-0000-4000-8000-000000000101', 1)$$,
  '42501', null, 'cart: a visitor cannot have a cart (D-032)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Place an order
-- ---------------------------------------------------------------------------

select pg_temp.as_r1();
set local role authenticated;

create temporary table t_order as
  select public.place_order('d0000000-0000-4000-8000-000000000001', 'pickup', null, '1020304050') as r;

select is((select r ->> 'created' from t_order), 'true', 'order: created from the cart');
select is(
  (select status::text || ':' || total_cop || ':' || fulfillment::text from public.orders
   where id = (select (r ->> 'order_id')::uuid from t_order)),
  'awaiting_payment:114000:pickup',
  'order: awaiting payment, 2 x 45.000 + 6 x 4.000, pickup'
);
select results_eq(
  $$select sku || ':' || quantity || ':' || unit_price_cop from public.order_items
    where order_id = (select (r ->> 'order_id')::uuid from t_order) order by sku$$,
  array['NAC-AGU-750:2:45000', 'NAC-CER-330:6:4000'],
  'order: items keep the server price at order time'
);
select is(jsonb_array_length(public.get_cart_items()), 0, 'order: the cart is emptied');
select is(
  (select (public.place_order('d0000000-0000-4000-8000-000000000001', 'pickup', null, '1020304050')) ->> 'order_id'),
  (select r ->> 'order_id' from t_order),
  'idempotency: the same key returns the same order (double click, two tabs)'
);
select is((select count(*)::int from public.orders), 1, 'idempotency: only one order exists');
select is(
  (select r ->> 'tracking_id' from t_order)::uuid,
  (select id from public.actions where idempotency_key = 'd0000000-0000-4000-8000-000000000001'),
  'tracking: the tracking_id is the id of the action'
);
select is(
  (select to_status::text from public.order_events
   where order_id = (select (r ->> 'order_id')::uuid from t_order)),
  'awaiting_payment', 'history: the creation is recorded'
);
reset role;

select is(pg_temp.reserved('00000000-0000-4000-8000-000000000101'), 2, 'stock: the units are reserved');

select pg_temp.as_r2();
set local role authenticated;
select is_empty($$select * from public.orders$$, 'rls: another customer cannot see the order');
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
select throws_ok(
  $$select public.place_order('d0000000-0000-4000-8000-000000000001', 'pickup', null, '1020304050')$$,
  'P0001', 'idempotency_key_conflict', 'idempotency: a key of another customer is rejected'
);
reset role;

-- ---------------------------------------------------------------------------
-- Rejected orders leave nothing behind
-- ---------------------------------------------------------------------------

select pg_temp.as_r1();
set local role authenticated;

select is(
  public.place_order(gen_random_uuid()) ->> 'error', 'cart_empty', 'reject: an empty cart'
);
select public.set_cart_item('00000000-0000-4000-8000-000000000103', 3);
select is(
  public.place_order(gen_random_uuid()) ->> 'error', 'quote_failed', 'reject: below the minimum'
);
select public.set_cart_item('00000000-0000-4000-8000-000000000103', 0);
select public.set_cart_item('00000000-0000-4000-8000-000000000201', 1);
select is(
  public.place_order(gen_random_uuid()) ->> 'error', 'quote_failed', 'reject: an imported product for a retail customer'
);
select public.set_cart_item('00000000-0000-4000-8000-000000000201', 0);
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 200);
select is(
  public.place_order('d0000000-0000-4000-8000-000000000009', 'pickup', null, '1020304050') ->> 'error', 'insufficient_stock', 'reject: not enough stock'
);
select is((select count(*)::int from public.orders), 1, 'reject: no order was created');
-- Delivery exists since step 14; without an address it is rejected.
select is(
  public.place_order(gen_random_uuid(), 'delivery') ->> 'reason', 'address_not_found',
  'reject: delivery without an address'
);
reset role;

select is(pg_temp.reserved('00000000-0000-4000-8000-000000000101'), 2, 'reject: nothing extra was reserved');

-- ---------------------------------------------------------------------------
-- Cancel
-- ---------------------------------------------------------------------------

select pg_temp.as_r1();
set local role authenticated;
select is(
  public.cancel_order((select (r ->> 'order_id')::uuid from t_order)), true,
  'cancel: the customer cancels an unpaid order'
);
reset role;
select is(pg_temp.reserved('00000000-0000-4000-8000-000000000101'), 0, 'cancel: the reservation is released');

-- ---------------------------------------------------------------------------
-- Abandoned orders
-- ---------------------------------------------------------------------------

select pg_temp.as_w1();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
create temporary table t_w as select public.place_order(gen_random_uuid(), 'pickup', null, '1020304050') as r;
reset role;

update public.orders set cancel_after = now() - interval '1 minute'
where id = (select (r ->> 'order_id')::uuid from t_w);
select is(public.cancel_abandoned_orders(), 1, 'abandoned: an order unpaid after 24 hours is cancelled');

select * from finish();
rollback;
