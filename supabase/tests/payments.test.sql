-- Tests for Wompi payments: attempts, events and idempotent processing
-- (plan step 12, D-040). Uses seed products and stock. Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('e0000000-0000-4000-8000-000000000001', 'p1@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('e0000000-0000-4000-8000-000000000002', 'p2@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');
insert into public.customers (id, customer_type, full_name) values
  ('e0000000-0000-4000-8000-000000000001', 'retail', 'P1'),
  ('e0000000-0000-4000-8000-000000000002', 'retail', 'P2');

create function pg_temp.as_p1() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
-- A transaction.updated event as Wompi sends it.
create function pg_temp.event(p_ref text, p_status text, p_cents bigint, p_tx text) returns jsonb language sql as $$
  select jsonb_build_object(
    'event', 'transaction.updated',
    'data', jsonb_build_object('transaction', jsonb_build_object(
      'id', p_tx, 'reference', p_ref, 'status', p_status,
      'amount_in_cents', p_cents, 'currency', 'COP', 'payment_method_type', 'CARD')),
    'sent_at', now()::text
  );
$$;
create function pg_temp.apply(p_checksum text, p_payload jsonb) returns text language sql as $$
  select public.apply_payment_event(
    (public.store_payment_event(p_checksum, 'webhook', p_payload) ->> 'event_id')::uuid);
$$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- Order O: 2 aguardientes = $90.000.
select pg_temp.as_p1();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 2);
create temporary table t_o as select (public.place_order(gen_random_uuid()) ->> 'order_id')::uuid as id;
grant select on t_o to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Start a payment
-- ---------------------------------------------------------------------------

create temporary table t_a1 as
  select public.start_payment((select id from t_o), 'f0000000-0000-4000-8000-000000000001') as r;
select is((select r #>> '{attempt,amount_in_cents}' from t_a1), '9000000', 'start: amount in cents = total_cop x 100');
select ok((select r #>> '{attempt,reference}' from t_a1) like '%-1', 'start: the reference is unique per attempt');
select is(
  public.start_payment((select id from t_o), 'f0000000-0000-4000-8000-000000000001') #>> '{attempt,id}',
  (select r #>> '{attempt,id}' from t_a1),
  'start: the same key returns the same attempt (double click)'
);

create temporary table t_a2 as
  select public.start_payment((select id from t_o), 'f0000000-0000-4000-8000-000000000002') as r;
select ok((select r #>> '{attempt,reference}' from t_a2) like '%-2', 'start: a new intent replaces an unused attempt');
select is(
  (select status::text from public.payment_attempts where id = (select (r #>> '{attempt,id}')::uuid from t_a1)),
  'abandoned', 'start: the previous attempt is closed (never two open)'
);

select public.record_payment_redirect((select id from t_o), 'tx-0001-ABC');
select is(
  public.start_payment((select id from t_o), 'f0000000-0000-4000-8000-000000000003') ->> 'error',
  'payment_in_progress', 'start: no new attempt while a transaction is in progress (PSE)'
);
grant select on t_a1, t_a2 to service_role;
select is_empty($$select * from public.payment_events$$, 'rls: a customer cannot read raw payment events');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
set local role authenticated;
select throws_ok(
  $$select public.start_payment((select id from t_o), gen_random_uuid())$$,
  '42501', 'payment_order_not_found', 'rls: another customer cannot pay my order'
);
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select public.start_payment((select id from t_o), gen_random_uuid())$$,
  '42501', null, 'rls: a visitor cannot start payments'
);
reset role;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

select pg_temp.as_service();
set local role service_role;

select is(
  public.clear_mismatched_payment_hint(
    (select (r #>> '{attempt,id}')::uuid from t_a2), 'tx-0001-ABC', (select r #>> '{attempt,reference}' from t_a2)),
  false, 'reconcile: a hint whose transaction matches the attempt is kept'
);
select is(
  (select transaction_id from public.payments_to_reconcile(0)),
  'tx-0001-ABC', 'reconcile: an attempt with a transaction hint is listed'
);

create temporary table t_ref as select r #>> '{attempt,reference}' as ref from t_a2;
grant select on t_ref to service_role;

select is(
  public.store_payment_event('aa01', 'webhook', pg_temp.event((select ref from t_ref), 'APPROVED', 100, 'tx-0001-ABC')) ->> 'created',
  'true', 'events: a new event is stored'
);
select is(
  public.store_payment_event('AA01', 'webhook', pg_temp.event((select ref from t_ref), 'APPROVED', 100, 'tx-0001-ABC')) ->> 'created',
  'false', 'events: a duplicate (same checksum, any case) is stored once'
);
select is(
  public.apply_payment_event((select id from public.payment_events where checksum = 'AA01')),
  'amount_mismatch', 'events: a different amount is never accepted'
);
reset role;
select is((select status::text from public.orders where id = (select id from t_o)), 'awaiting_payment',
  'events: the order stays unpaid after an amount mismatch');
set local role service_role;

select is(pg_temp.apply('bb01', pg_temp.event((select ref from t_ref), 'PENDING', 9000000, 'tx-0001-ABC')),
  'pending_ignored', 'events: PENDING keeps waiting (PSE)');
select is(pg_temp.apply('bb02', pg_temp.event((select ref from t_ref), 'APPROVED', 9000000, 'tx-0001-ABC')),
  'applied_approved', 'events: APPROVED is applied');
reset role;

select is(
  (select status::text || ':' || needs_refund from public.orders where id = (select id from t_o)),
  'paid:false', 'approved: the order is paid'
);
select is(
  (select on_hand || '/' || reserved from public.product_stock where product_id = '00000000-0000-4000-8000-000000000101'),
  '118/0', 'approved: the reservation became a sale (120 - 2)'
);
select is(
  (select status::text || ':' || wompi_transaction_id from public.payment_attempts
   where reference = (select ref from t_ref)),
  'approved:tx-0001-ABC', 'approved: the attempt keeps the Wompi transaction id'
);

set local role service_role;
select is(public.apply_payment_event((select id from public.payment_events where checksum = 'BB02')),
  'already_processed', 'idempotency: the same event is not applied twice');
select is(pg_temp.apply('bb03', pg_temp.event((select ref from t_ref), 'PENDING', 9000000, 'tx-0001-ABC')),
  'already_final', 'order: a late PENDING does not move a final state backwards');
select is(pg_temp.apply('bb04', pg_temp.event('NOPE-1', 'APPROVED', 9000000, 'tx-x')),
  'unknown_reference', 'events: an unknown reference is recorded, not applied');
reset role;
select is(
  (select on_hand from public.product_stock where product_id = '00000000-0000-4000-8000-000000000101'),
  118, 'idempotency: the stock was taken only once'
);

-- ---------------------------------------------------------------------------
-- Declined, then approved on a new attempt
-- ---------------------------------------------------------------------------

select pg_temp.as_p1();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000102', 1);
create temporary table t_o2 as select (public.place_order(gen_random_uuid()) ->> 'order_id')::uuid as id;
create temporary table t_b1 as select public.start_payment((select id from t_o2), gen_random_uuid()) as r;
grant select on t_o2, t_b1 to service_role;
reset role;

select pg_temp.as_service();
set local role service_role;
select is(pg_temp.apply('cc01', pg_temp.event((select r #>> '{attempt,reference}' from t_b1), 'DECLINED', 5200000, 'tx-0002')),
  'applied_declined', 'declined: the attempt fails');
reset role;
select is((select status::text from public.orders where id = (select id from t_o2)), 'awaiting_payment',
  'declined: the order stays open so the customer can retry');

select pg_temp.as_p1();
set local role authenticated;
select ok(
  (public.start_payment((select id from t_o2), gen_random_uuid()) #>> '{attempt,reference}') like '%-2',
  'declined: a new attempt is allowed after a declined one'
);
reset role;

-- ---------------------------------------------------------------------------
-- Money that cannot be fulfilled is flagged for refund
-- ---------------------------------------------------------------------------

-- O2 is cancelled after 24 hours, then Wompi approves the payment.
select private.cancel_web_order((select id from t_o2), 'payment_window_expired');
select pg_temp.as_service();
set local role service_role;
select is(
  pg_temp.apply('dd01', pg_temp.event(
    (select reference from public.payment_attempts where order_id = (select id from t_o2) and attempt_number = 2),
    'APPROVED', 5200000, 'tx-0003')),
  'applied_approved', 'refund: a payment for a cancelled order is recorded'
);
reset role;
select is(
  (select status::text || ':' || refund_reason from public.orders where id = (select id from t_o2)),
  'cancelled:payment_for_closed_order', 'refund: the cancelled order is flagged, not reopened'
);

-- O3: the reservation expires and the POS sells everything before the payment.
select pg_temp.as_p1();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000201', 0);
select public.set_cart_item('00000000-0000-4000-8000-000000000103', 6);
create temporary table t_o3 as select (public.place_order(gen_random_uuid()) ->> 'order_id')::uuid as id;
create temporary table t_c1 as select public.start_payment((select id from t_o3), gen_random_uuid()) as r;
grant select on t_o3, t_c1 to service_role;
reset role;

update public.stock_reservations set expires_at = now() - interval '1 minute'
where reference = (select id::text from t_o3);
select public.release_expired_reservations();
insert into public.inventory_movements (product_id, movement_type, units, reference)
select product_id, 'pos_sale', -(on_hand - reserved), 'pos-all'
from public.product_stock where product_id = '00000000-0000-4000-8000-000000000103';

select pg_temp.as_service();
set local role service_role;
select pg_temp.apply('ee01', pg_temp.event((select r #>> '{attempt,reference}' from t_c1), 'APPROVED', 2400000, 'tx-0004'));
reset role;
select is(
  (select status::text || ':' || refund_reason from public.orders where id = (select id from t_o3)),
  'paid:insufficient_stock_after_payment', 'refund: paid without stock is flagged for refund'
);

-- A hint pointing to a transaction of another attempt is dropped.
update public.payment_attempts set transaction_id_hint = 'tx-other'
where order_id = (select id from t_o2) and attempt_number = 1;
select is(
  public.clear_mismatched_payment_hint(
    (select id from public.payment_attempts where order_id = (select id from t_o2) and attempt_number = 1),
    'tx-other', 'SOMEONE-ELSES-REF-1'),
  true, 'reconcile: a hint whose transaction belongs to another attempt is dropped'
);

select * from finish();
rollback;
