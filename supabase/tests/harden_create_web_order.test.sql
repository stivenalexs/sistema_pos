-- Tests for the hardened private.create_web_order (plan step 17d-3, D-066).
-- Uses the sample products and stock of seed.sql. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('d8000000-0000-4000-8000-000000000001', 'web1@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('d8000000-0000-4000-8000-000000000002', 'web2@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('d8000000-0000-4000-8000-000000000003', 'web3@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');
insert into public.customers (id, customer_type, wholesale_status, full_name) values
  ('d8000000-0000-4000-8000-000000000001', 'retail', null, 'Web 1'),
  ('d8000000-0000-4000-8000-000000000002', 'retail', null, 'Web 2'),
  ('d8000000-0000-4000-8000-000000000003', 'wholesale', 'approved', 'Web 3');

create function pg_temp.as_customer(p_id text, p_meta text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":' || p_meta || '}', true);
$$;
create function pg_temp.as_web1() returns void language sql as $$
  select pg_temp.as_customer('d8000000-0000-4000-8000-000000000001', '{"customer_type":"retail"}');
$$;
create function pg_temp.as_web2() returns void language sql as $$
  select pg_temp.as_customer('d8000000-0000-4000-8000-000000000002', '{"customer_type":"retail"}');
$$;
create function pg_temp.as_web3() returns void language sql as $$
  select pg_temp.as_customer('d8000000-0000-4000-8000-000000000003', '{"customer_type":"wholesale","wholesale_approved":true}');
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Signature: the version that received a quote is gone
-- ---------------------------------------------------------------------------

select hasnt_function('private', 'create_web_order',
  array['uuid', 'uuid', 'fulfillment_method', 'jsonb', 'uuid'],
  'signature: the old version that trusted a quote is gone');
select has_function('private', 'create_web_order', array['uuid', 'fulfillment_method', 'uuid', 'text'],
  'signature: the new version takes key, fulfillment, address and the pickup document (18a)');

-- ---------------------------------------------------------------------------
-- Called directly: same as place_order, prices from the server
-- ---------------------------------------------------------------------------

select pg_temp.as_web1();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 2);
create temporary table t_direct as
  select private.create_web_order('d9000000-0000-4000-8000-000000000001', 'pickup', null, '1020304050') as r;
select is((select r ->> 'created' from t_direct), 'true', 'direct: the order is created from the session cart');
select results_eq(
  $$select total_cop, subtotal_cop, sale_unit, total_base_units from public.orders
    where id = (select (r ->> 'order_id')::uuid from t_direct)$$,
  $$values (90000::bigint, 90000::bigint, 'unit', 2)$$,
  'direct: totals come from the server quote (2 x $ 45.000)'
);
select is((select count(*)::int from public.cart_items), 0, 'direct: the cart is emptied');
select is(
  private.create_web_order('d9000000-0000-4000-8000-000000000001', 'pickup', null, '1020304050') ->> 'order_id',
  (select r ->> 'order_id' from t_direct),
  'direct: the same key returns the same order, even with the cart empty'
);
select is(private.create_web_order(gen_random_uuid(), 'pickup', null, '1020304050') ->> 'error', 'cart_empty',
  'direct: an empty cart creates nothing');

reset role;

-- An imported product in a retail cart (put there behind set_cart_item's back)
-- is still refused by the quote.
insert into public.cart_items (cart_id, product_id, quantity)
  select id, '00000000-0000-4000-8000-000000000201', 1 from public.carts
  where customer_id = 'd8000000-0000-4000-8000-000000000001';
select pg_temp.as_web1();
set local role authenticated;
select is(private.create_web_order(gen_random_uuid(), 'pickup', null, '1020304050') ->> 'error', 'quote_failed',
  'direct: a retail customer still cannot order an imported product');
reset role;
delete from public.cart_items;

-- Approved wholesale: by box at the wholesale price, from its own claims.
select pg_temp.as_web3();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
create temporary table t_wholesale as
  select private.create_web_order(gen_random_uuid(), 'pickup', null, '1020304050') as r;
select results_eq(
  $$select o.sale_unit, o.total_base_units from public.orders o
    where o.id = (select (r ->> 'order_id')::uuid from t_wholesale)$$,
  $$values ('box', 12)$$,
  'direct: an approved wholesale customer orders by box'
);
reset role;

-- ---------------------------------------------------------------------------
-- Who can call it
-- ---------------------------------------------------------------------------

select pg_temp.as_web2();
set local role authenticated;
select throws_ok(
  $$select private.create_web_order('d9000000-0000-4000-8000-000000000001', 'pickup', null, '1020304050')$$,
  'P0001', 'idempotency_key_conflict', 'key: another customer''s key is refused'
);
select is(public.place_order(gen_random_uuid()) ->> 'error', 'cart_empty',
  'place_order: the same answers as before');
reset role;

set local role anon;
select throws_ok($$select private.create_web_order(gen_random_uuid(), 'pickup', null, '1020304050')$$, '42501', null,
  'anon: a visitor cannot call it');
reset role;

select pg_temp.as_customer('d8000000-0000-4000-8000-000000000099', '{"customer_type":"retail"}');
set local role authenticated;
select throws_ok($$select private.create_web_order(gen_random_uuid(), 'pickup', null, '1020304050')$$, '42501',
  'order_requires_customer', 'session: a user without a customer row cannot order');
reset role;

select * from finish();
rollback;
