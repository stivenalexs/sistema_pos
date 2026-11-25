-- Reconciliation by turns, unknown hints and the queue guard for actions
-- still being processed (thermos findings, D-071; D-073). Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('e7000000-0000-4000-8000-000000000001', 'rq1@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');
insert into public.customers (id, customer_type, full_name) values
  ('e7000000-0000-4000-8000-000000000001', 'retail', 'RQ1');

create function pg_temp.as_customer() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"e7000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
$$;
-- One order with one payment attempt, as the customer would make it.
create function pg_temp.order_with_attempt() returns uuid language plpgsql as $$
declare v_order uuid;
begin
  perform public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
  v_order := (public.place_order(gen_random_uuid(), 'pickup', null, '1020304050') ->> 'order_id')::uuid;
  perform public.start_payment(v_order, gen_random_uuid());
  return v_order;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.as_customer();
set local role authenticated;
create temporary table t_orders (name text primary key, id uuid);
grant all on t_orders to authenticated;
insert into t_orders values
  ('fake', pg_temp.order_with_attempt()),
  ('real', pg_temp.order_with_attempt()),
  ('cancelled', pg_temp.order_with_attempt()),
  ('old_cancelled', pg_temp.order_with_attempt()),
  ('confirmed', pg_temp.order_with_attempt()),
  ('mismatch', pg_temp.order_with_attempt());
-- Browser hints (?id=), as anyone can store them on their own orders.
select public.record_payment_redirect((select id from t_orders where name = 'fake'), 'tx-fake-0001');
select public.record_payment_redirect((select id from t_orders where name = 'real'), 'tx-real-0002');
select public.record_payment_redirect((select id from t_orders where name = 'cancelled'), 'tx-fake-0003');
select public.record_payment_redirect((select id from t_orders where name = 'old_cancelled'), 'tx-fake-0004');
select public.record_payment_redirect((select id from t_orders where name = 'confirmed'), 'tx-conf-0005');
select public.record_payment_redirect((select id from t_orders where name = 'mismatch'), 'tx-mism-0006');
select public.cancel_order((select id from t_orders where name = 'cancelled'));
select public.cancel_order((select id from t_orders where name = 'old_cancelled'));
select public.cancel_order((select id from t_orders where name = 'confirmed'));
select public.cancel_order((select id from t_orders where name = 'mismatch'));
reset role;

create function pg_temp.attempt(p_name text) returns public.payment_attempts language sql as $$
  select pa.* from public.payment_attempts pa
  join t_orders o on o.id = pa.order_id
  where o.name = p_name and pa.status in ('pending', 'abandoned')
  order by pa.attempt_number desc limit 1;
$$;

-- Old enough to reconcile; "fake" is the oldest. Two orders closed 3 days
-- ago: one with only a hint, one with a transaction confirmed by an event.
update public.payment_attempts pa set created_at = now() - interval '1 hour'
from t_orders o where o.id = pa.order_id;
update public.payment_attempts set created_at = now() - interval '2 hours'
where id = (pg_temp.attempt('fake')).id;
update public.orders set cancelled_at = now() - interval '3 days'
where id in (select id from t_orders where name in ('old_cancelled', 'confirmed'));
update public.payment_attempts set wompi_transaction_id = 'tx-conf-0005'
where id = (pg_temp.attempt('confirmed')).id;

-- ---------------------------------------------------------------------------
-- Turns
-- ---------------------------------------------------------------------------

select is(
  (select status::text from public.payment_attempts where id = (pg_temp.attempt('cancelled')).id),
  'pending', 'setup: a cancelled order with a hint keeps its attempt pending'
);

create temporary table t_run1 as select * from public.payments_to_reconcile(0, 1);
select is((select transaction_id from t_run1), 'tx-fake-0001', 'turns: the first run takes the oldest attempt never asked about');
select ok((pg_temp.attempt('fake')).last_reconciled_at is not null, 'turns: the attempt is stamped');

select is(
  (pg_temp.attempt('old_cancelled')).status::text, 'abandoned',
  'old closed: only a hint and the order closed more than 48 hours ago, the attempt is closed'
);
select is(
  (pg_temp.attempt('confirmed')).status::text, 'pending',
  'old closed: a confirmed transaction stays pending'
);

-- Four others are eligible: a run of four.
create temporary table t_run2 as select * from public.payments_to_reconcile(0, 4);
select ok(
  not exists (select 1 from t_run2 where transaction_id = 'tx-fake-0001'),
  'turns: the next run starts with the others, not the same one again'
);
select ok(
  exists (select 1 from t_run2 where transaction_id = 'tx-real-0002'),
  'turns: a legitimate attempt is reached even behind a clogging one'
);
select ok(
  exists (select 1 from t_run2 where transaction_id = 'tx-fake-0003'),
  'turns: a recently cancelled order is still asked about (a late PSE)'
);
select ok(
  exists (select 1 from t_run2 where transaction_id = 'tx-conf-0005'),
  'turns: a confirmed transaction is always asked about'
);
select is(
  (select count(*)::int from public.payments_to_reconcile(0, 10) where transaction_id = 'tx-fake-0001'),
  1, 'turns: after everyone had a turn, it comes back'
);

-- ---------------------------------------------------------------------------
-- Unknown and mismatched hints
-- ---------------------------------------------------------------------------

select is(public.clear_unknown_payment_hint((pg_temp.attempt('fake')).id, 'tx-fake-0001'), true,
  'unknown: the hint is dropped');
select is(
  (select status::text || ':' || coalesce(transaction_id_hint, '-') from public.payment_attempts where id = (pg_temp.attempt('fake')).id),
  'pending:-', 'unknown: the attempt of an open order stays pending, without hint'
);
select ok(
  not exists (select 1 from public.payments_to_reconcile(0, 50) where attempt_id = (pg_temp.attempt('fake')).id),
  'unknown: it is not asked about again'
);
select is(public.clear_unknown_payment_hint((pg_temp.attempt('cancelled')).id, 'tx-fake-0003'), true,
  'unknown: the hint of a cancelled order is dropped');
select is((pg_temp.attempt('cancelled')).status::text, 'abandoned', 'unknown: and its attempt is closed');
select is(public.clear_unknown_payment_hint((pg_temp.attempt('confirmed')).id, 'tx-conf-0005'), false,
  'unknown: a confirmed transaction id is never dropped');
select is(public.clear_mismatched_payment_hint((pg_temp.attempt('mismatch')).id, 'tx-mism-0006', 'SOMEONE-ELSES-REF'), true,
  'mismatched: the hint of another attempt is dropped');
select is((pg_temp.attempt('mismatch')).status::text, 'abandoned',
  'mismatched: and the attempt is closed when its order no longer waits for a payment');

select pg_temp.as_customer();
set local role authenticated;
select throws_ok(
  $$select public.clear_unknown_payment_hint(gen_random_uuid(), 'tx-x-000001')$$,
  '42501', null, 'permissions: a customer cannot drop hints'
);
reset role;

-- ---------------------------------------------------------------------------
-- Queue: an action still being processed is not handed out again
-- ---------------------------------------------------------------------------

delete from pgmq.q_actions;
create temporary table t_act as
  select * from public.enqueue_action(gen_random_uuid(), 'noop', 'e7000000-0000-4000-8000-000000000001', '{}');
select * from public.claim_actions(1, 60);
-- Its visibility ran out while the first worker is still running it.
select pgmq.set_vt('actions', (select queue_msg_id from public.actions where id = (select tracking_id from t_act)), 0);

select is(
  (select count(*)::int from public.claim_actions(1, 120)),
  0, 'queue: an action processing for less than 10 minutes is not claimed twice'
);
select ok(
  (select vt > now() + interval '100 seconds' from pgmq.q_actions
   where msg_id = (select queue_msg_id from public.actions where id = (select tracking_id from t_act))),
  'queue: its message stays hidden for the visibility asked for'
);
-- (The first worker's complete_action still finds it processing.)
select public.complete_action((select tracking_id from t_act), '{"ok":true}');
select is(
  (select status::text || ':' || attempts from public.actions where id = (select tracking_id from t_act)),
  'succeeded:1', 'queue: the first worker completes it, run once'
);

-- A skipped message does not leave a batch of one empty: the next queued
-- action is handed out.
create temporary table t_busy as
  select * from public.enqueue_action(gen_random_uuid(), 'noop', 'e7000000-0000-4000-8000-000000000001', '{}');
select * from public.claim_actions(1, 60);
select pgmq.set_vt('actions', (select queue_msg_id from public.actions where id = (select tracking_id from t_busy)), 0);
create temporary table t_next as
  select * from public.enqueue_action(gen_random_uuid(), 'noop', 'e7000000-0000-4000-8000-000000000001', '{}');
select is(
  (select action_id from public.claim_actions(1, 60)),
  (select tracking_id from t_next),
  'queue: behind a skipped message, a batch of one still gets the next action'
);
select is(
  (select count(*)::int from public.claim_actions(1, 60)),
  0, 'queue: with nothing visible left, the claim ends empty'
);

-- A worker that died: after 10 minutes the action is claimed again.
update public.actions set started_at = now() - interval '11 minutes' where id = (select tracking_id from t_busy);
select pgmq.set_vt('actions', (select queue_msg_id from public.actions where id = (select tracking_id from t_busy)), 0);
select is(
  (select attempt from public.claim_actions(1, 60)),
  2, 'queue: an action stuck in processing for 10 minutes is claimed again (dead worker)'
);

select * from finish();
rollback;
