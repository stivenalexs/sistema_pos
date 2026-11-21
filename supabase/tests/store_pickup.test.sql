-- Tests for store pickup confirmed by the customer (plan step 18a, D-067).
-- Uses the sample products and stock of seed.sql. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

-- The wholesale NIT is stored with its DIAN check digit (900123456 -> 8).
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('d6000000-0000-4000-8000-000000000001', 'pick1@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('d6000000-0000-4000-8000-000000000002', 'pick2@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('d6000000-0000-4000-8000-000000000003', 'pick3@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('d6000000-0000-4000-8000-000000000004', 'pickcash@test.local', 'authenticated', 'authenticated', '{"staff_role":"cashier"}');
insert into public.customers (id, customer_type, wholesale_status, full_name, document_type, document_number) values
  ('d6000000-0000-4000-8000-000000000001', 'retail', null, 'Minorista 1', null, null),
  ('d6000000-0000-4000-8000-000000000002', 'retail', null, 'Minorista 2', null, null),
  ('d6000000-0000-4000-8000-000000000003', 'wholesale', 'approved', 'Mayorista', 'nit', '9001234568');

create function pg_temp.as_user(p_id text, p_meta text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":' || p_meta || '}', true);
$$;
create function pg_temp.as_r1() returns void language sql as $$
  select pg_temp.as_user('d6000000-0000-4000-8000-000000000001', '{"customer_type":"retail"}');
$$;
create function pg_temp.as_r2() returns void language sql as $$
  select pg_temp.as_user('d6000000-0000-4000-8000-000000000002', '{"customer_type":"retail"}');
$$;
create function pg_temp.as_w() returns void language sql as $$
  select pg_temp.as_user('d6000000-0000-4000-8000-000000000003', '{"customer_type":"wholesale","wholesale_approved":true}');
$$;
create function pg_temp.as_cashier() returns void language sql as $$
  select pg_temp.as_user('d6000000-0000-4000-8000-000000000004', '{"staff_role":"cashier"}');
$$;
-- Places a 1-bottle pickup order for the current session.
create function pg_temp.pickup_order(p_document text) returns jsonb language sql as $$
  select public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
  select public.place_order(gen_random_uuid(), 'pickup', null, p_document);
$$;
create function pg_temp.doc(p_order jsonb) returns private.order_pickup_documents language sql as $$
  select * from private.order_pickup_documents where order_id = (p_order ->> 'order_id')::uuid;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Signatures and where the data lives
-- ---------------------------------------------------------------------------

select has_function('public', 'confirm_pickup', array['uuid', 'text'], 'signature: confirm_pickup exists');
select hasnt_function('private', 'create_web_order', array['uuid', 'fulfillment_method', 'uuid'],
  'signature: the version without the pickup document is gone');
select hasnt_column('public', 'orders', 'pickup_document_hash', 'privacy: no cédula hash in orders, which staff read');
select hasnt_column('public', 'orders', 'pickup_failed_attempts', 'privacy: no attempt counter in orders');

-- ---------------------------------------------------------------------------
-- Placing a pickup order
-- ---------------------------------------------------------------------------

select pg_temp.as_r1();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
select is(public.place_order(gen_random_uuid()) ->> 'error', 'pickup_document_required',
  'order: a retail pickup order needs the cédula of who picks it up');
select is(public.place_order(gen_random_uuid(), 'pickup', null, '12a') ->> 'error', 'invalid_pickup_document',
  'order: a malformed cédula is refused');
select is((select count(*)::int from public.orders), 0, 'order: nothing is created without a valid cédula');
select is(jsonb_array_length(public.get_cart_items()), 1, 'order: the cart is kept');

create temporary table t_a as
  select public.place_order('d7000000-0000-4000-8000-000000000001', 'pickup', null, '1.020.304.050') as r;
select is((select r ->> 'created' from t_a), 'true', 'order: created with a cédula typed with dots');
create temporary table t_b as select pg_temp.pickup_order('1020304050') as r;
create temporary table t_c as select pg_temp.pickup_order('43123456') as r;
grant select on t_a, t_b, t_c to authenticated, anon;
select is(public.get_pickup_status((select (r ->> 'order_id')::uuid from t_a)),
  '{"locked": false, "document_last3": "050"}'::jsonb, 'status: the customer sees the last 3 digits of their order');
reset role;

select results_eq(
  $$select document_last3, document_hash ~ '^[0-9a-f]{64}$', document_hash like '%1020304050%'
    from pg_temp.doc((select r from t_a))$$,
  $$values ('050', true, false)$$,
  'order: only the HMAC and the last 3 digits are kept, never the cédula'
);
select is(
  (select payload::text like '%1020304050%' from public.actions
   where idempotency_key = 'd7000000-0000-4000-8000-000000000001'),
  false, 'order: the cédula is not in the action payload'
);
select isnt((select document_hash from pg_temp.doc((select r from t_b))),
            (select document_hash from pg_temp.doc((select r from t_a))),
  'order: the same cédula gives a different hash in each order');

-- A customer with a registered NIT needs no cédula.
select pg_temp.as_w();
set local role authenticated;
create temporary table t_w as select pg_temp.pickup_order(null) as r;
grant select on t_w to authenticated, anon;
select is((select r ->> 'created' from t_w), 'true', 'order: a customer with a NIT orders pickup without a cédula');
reset role;
select is((select document_hash from pg_temp.doc((select r from t_w))), null,
  'order: no cédula is stored for a NIT customer');

-- Nobody reads the documents table from the API, not even staff.
select pg_temp.as_cashier();
set local role authenticated;
select throws_ok($$select * from private.order_pickup_documents$$, '42501', null,
  'privacy: a cashier cannot read the pickup documents');
select is(public.get_pickup_status((select (r ->> 'order_id')::uuid from t_a)), null,
  'privacy: a cashier gets no pickup status');
reset role;
select pg_temp.as_r2();
set local role authenticated;
select is(public.get_pickup_status((select (r ->> 'order_id')::uuid from t_a)), null,
  'privacy: another customer gets no pickup status');
reset role;

-- ---------------------------------------------------------------------------
-- Confirming the pickup
-- ---------------------------------------------------------------------------

select pg_temp.as_r1();
set local role authenticated;
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_a), '1020304050') ->> 'error',
  'pickup_not_available', 'confirm: not before the order is paid');
reset role;

update public.orders set status = 'paid', paid_at = now()
where id in (
  (select (r ->> 'order_id')::uuid from t_a),
  (select (r ->> 'order_id')::uuid from t_b),
  (select (r ->> 'order_id')::uuid from t_c),
  (select (r ->> 'order_id')::uuid from t_w)
);

select throws_ok(
  $$update public.orders set status = 'delivered' where id = (select (r ->> 'order_id')::uuid from t_b)$$,
  '23514', 'order_delivered_without_proof', 'proof: a pickup order is never delivered without its confirmation'
);

select pg_temp.as_r2();
set local role authenticated;
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_a), '1020304050') ->> 'error',
  'order_not_found', 'confirm: another customer cannot confirm it');
reset role;

set local role anon;
select throws_ok(
  $$select public.confirm_pickup((select (r ->> 'order_id')::uuid from t_a), '1020304050')$$,
  '42501', null, 'confirm: a visitor cannot call it'
);
reset role;

select pg_temp.as_r1();
set local role authenticated;
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_a), '12') ->> 'error',
  'invalid_document', 'confirm: a malformed document is refused');
select results_eq(
  $$select r ->> 'error', r ->> 'attempts_left'
    from (select public.confirm_pickup((select (r ->> 'order_id')::uuid from t_a), '99999999') as r) s$$,
  $$values ('document_mismatch', '4')$$,
  'confirm: a wrong cédula is refused and counted'
);
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_a), '1.020.304.050') ->> 'ok',
  'true', 'confirm: the right cédula confirms the pickup');
select results_eq(
  $$select status::text, delivered_at is not null
    from public.orders where id = (select (r ->> 'order_id')::uuid from t_a)$$,
  $$values ('delivered', true)$$,
  'confirm: the order is delivered'
);
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_a), '1020304050') ->> 'already_confirmed',
  'true', 'confirm: a second click answers the same');
select results_eq(
  $$select document_kind, confirmed_by from public.pickup_confirmations$$,
  $$values ('cedula', 'd6000000-0000-4000-8000-000000000001'::uuid)$$,
  'confirm: one confirmation, with the customer and the document kind'
);
select throws_ok(
  $$insert into public.pickup_confirmations (order_id, confirmed_by, document_kind)
    values ((select (r ->> 'order_id')::uuid from t_b), 'd6000000-0000-4000-8000-000000000001', 'cedula')$$,
  '42501', null, 'confirm: nobody inserts a confirmation directly'
);
reset role;

select is((select failed_attempts from pg_temp.doc((select r from t_a))), 1,
  'confirm: the malformed try was not counted, the wrong one was');

select pg_temp.as_r2();
set local role authenticated;
select is_empty($$select * from public.pickup_confirmations$$, 'rls: another customer does not see the confirmation');
select throws_ok($$select * from private.pickup_secrets$$, '42501', null, 'secret: the pepper is not readable');
reset role;

select throws_ok(
  $$delete from public.pickup_confirmations$$,
  null, null, 'confirm: the confirmation cannot be deleted, not even by postgres'
);

-- ---------------------------------------------------------------------------
-- NIT: with or without the real DIAN check digit, never a truncated number
-- ---------------------------------------------------------------------------

select is(private.nit_check_digit('900123456'), 8, 'nit: DIAN check digit of 900123456 is 8');
select ok(private.nit_matches('900123456', '9001234568'), 'nit: typed without the check digit, stored with it');
select ok(private.nit_matches('9001234568', '900123456'), 'nit: typed with the check digit, stored without it');
select ok(not private.nit_matches('900123456', '9001234567'),
  'nit: a stored 10-digit number whose last digit is not the check digit is not accepted truncated');
select ok(not private.nit_matches('9001234561', '900123456'), 'nit: a wrong check digit is refused');

select pg_temp.as_w();
set local role authenticated;
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_w), '9001234567') ->> 'error',
  'document_mismatch', 'nit: the NIT with a wrong check digit is refused');
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_w), '900.123.456') ->> 'ok',
  'true', 'nit: the registered NIT without its check digit confirms');
select is((select document_kind from public.pickup_confirmations
           where order_id = (select (r ->> 'order_id')::uuid from t_w)),
  'nit', 'nit: the confirmation says NIT');
reset role;

-- ---------------------------------------------------------------------------
-- Each order is confirmed with the method it was placed with
-- ---------------------------------------------------------------------------

update public.customers set document_type = 'nit', document_number = '8009999991'
where id = 'd6000000-0000-4000-8000-000000000001';
select pg_temp.as_r1();
set local role authenticated;
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_c), '8009999991') ->> 'error',
  'document_mismatch', 'method: an order placed with a cédula is not confirmed with a NIT added later');
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_c), '43.123.456') ->> 'ok',
  'true', 'method: it is confirmed with its cédula');
reset role;

-- ---------------------------------------------------------------------------
-- Lock, fail closed and refunds
-- ---------------------------------------------------------------------------

select pg_temp.as_r1();
set local role authenticated;
select public.confirm_pickup((select (r ->> 'order_id')::uuid from t_b), '11111111')
from generate_series(1, 4);
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_b), '11111111') ->> 'attempts_left',
  '0', 'lock: the fifth wrong document leaves no attempts');
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_b), '1020304050') ->> 'error',
  'pickup_locked', 'lock: then even the right cédula is refused');
select is(public.get_pickup_status((select (r ->> 'order_id')::uuid from t_b)) ->> 'locked', 'true',
  'lock: the customer sees it locked');
reset role;

-- Without the pepper nothing is confirmed (fails closed, never compares nulls).
update private.order_pickup_documents set failed_attempts = 0
where order_id = (select (r ->> 'order_id')::uuid from t_b);
delete from private.pickup_secrets;
select pg_temp.as_r1();
set local role authenticated;
select throws_ok(
  $$select public.confirm_pickup((select (r ->> 'order_id')::uuid from t_b), '1020304050')$$,
  'P0001', 'pickup_document_hash_unavailable', 'fail closed: without the pepper the pickup is not confirmed'
);
reset role;
select is((select status::text from public.orders where id = (select (r ->> 'order_id')::uuid from t_b)),
  'paid', 'fail closed: the order stays paid');

-- An order marked for refund cannot be picked up.
update public.orders set needs_refund = true, refund_reason = 'insufficient_stock_after_payment'
where id = (select (r ->> 'order_id')::uuid from t_b);
select pg_temp.as_r1();
set local role authenticated;
select is(public.confirm_pickup((select (r ->> 'order_id')::uuid from t_b), '1020304050') ->> 'error',
  'pickup_not_available', 'refund: an order to refund cannot be picked up');
reset role;

select * from finish();
rollback;
