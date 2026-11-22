-- Tests for duplicate payments (D-071 finding, D-072): a second approved
-- payment refunds only that attempt and never touches the paid order.
-- Uses seed products and stock. Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('e7000000-0000-4000-8000-000000000001', 'dup1@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('e7000000-0000-4000-8000-000000000002', 'dupadmin@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}');
insert into public.customers (id, customer_type, full_name) values
  ('e7000000-0000-4000-8000-000000000001', 'retail', 'Dup 1');

create function pg_temp.as_customer() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"e7000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"e7000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"staff_role":"admin"}}', true);
$$;
create function pg_temp.event(p_ref text, p_status text, p_cents bigint, p_tx text) returns jsonb language sql as $$
  select jsonb_build_object(
    'event', 'transaction.updated',
    'data', jsonb_build_object('transaction', jsonb_build_object(
      'id', p_tx, 'reference', p_ref, 'status', p_status,
      'amount_in_cents', p_cents, 'currency', 'COP', 'payment_method_type', 'CARD')),
    'sent_at', now()::text
  );
$$;
-- The worker applies events with the server session.
create function pg_temp.apply(p_checksum text, p_payload jsonb) returns text language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select public.apply_payment_event(
    (public.store_payment_event(p_checksum, 'webhook', p_payload) ->> 'event_id')::uuid);
$$;
-- A pickup order of 1 aguardiente for the customer, with two payment attempts:
-- the first replaced (abandoned) by the second, both still payable in Wompi.
create function pg_temp.order_with_two_attempts() returns uuid language plpgsql as $$
declare
  v_order uuid;
begin
  perform pg_temp.as_customer();
  perform public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
  v_order := (public.place_order(gen_random_uuid(), 'pickup', null, '1020304050') ->> 'order_id')::uuid;
  perform public.start_payment(v_order, gen_random_uuid());
  perform public.start_payment(v_order, gen_random_uuid());
  return v_order;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

create temporary table t_o as select pg_temp.order_with_two_attempts() as id;
grant select on t_o to authenticated;
create temporary table t_att as
  select id, reference, amount_in_cents, status::text as status, attempt_number
  from public.payment_attempts where order_id = (select id from t_o);

select is((select string_agg(status, ',' order by attempt_number) from t_att), 'abandoned,pending',
  'setup: the first attempt was replaced, both checkouts are still payable');

-- The customer pays both checkouts.
select pg_temp.apply('dup-1', pg_temp.event((select reference from t_att where attempt_number = 1), 'APPROVED',
  (select amount_in_cents from t_att where attempt_number = 1), 'tx-dup-1'));
select is((select status::text from public.orders where id = (select id from t_o)), 'paid',
  'first payment: the order is paid');

select results_eq(
  $$select status::text from public.payment_attempts where order_id = (select id from t_o) and attempt_number = 2$$,
  $$values ('abandoned')$$,
  'first payment: the other unused attempt is closed'
);

select pg_temp.apply('dup-2', pg_temp.event((select reference from t_att where attempt_number = 2), 'APPROVED',
  (select amount_in_cents from t_att where attempt_number = 2), 'tx-dup-2'));
select results_eq(
  $$select status::text, needs_refund from public.orders where id = (select id from t_o)$$,
  $$values ('paid', false)$$,
  'second payment: the order stays paid and is NOT marked for refund'
);
select results_eq(
  $$select status::text, refund_needed, refund_reason from public.payment_attempts
    where order_id = (select id from t_o) and attempt_number = 2$$,
  $$values ('approved', true, 'duplicate_payment')$$,
  'second payment: only that attempt is marked for refund'
);
select is(
  (select count(*)::int from public.inventory_movements
   where reference = (select id::text from t_o) and movement_type = 'web_sale'),
  1, 'stock: sold once');
select is(
  (select count(*)::int from public.actions
   where idempotency_key = private.uuid_from_text('issue_invoice:' || (select id::text from t_o))),
  1, 'invoice: still issued once for the order');

-- The panel lists the duplicate payment with its own amount.
select pg_temp.as_admin();
set local role authenticated;
select results_eq(
  $$select r ->> 'kind', r ->> 'refund_reason', (r ->> 'refund_amount_cop')::bigint
    from jsonb_array_elements(public.admin_list_refunds()) r where r ->> 'order_id' = (select id::text from t_o)$$,
  $$values ('payment', 'duplicate_payment', 45000::bigint)$$,
  'panel: one refund, of the duplicate payment only'
);
select is((public.admin_summary() ->> 'refunds_pending')::int >= 1, true, 'panel: the summary counts it');
create temporary table t_mark as
  select public.mark_attempt_refunded(
    (select id from public.payment_attempts where order_id = (select id from t_o) and attempt_number = 2),
    'WOMPI-DUP-1', 'Pago duplicado devuelto') as r;
select is((select r ->> 'ok' from t_mark), 'true', 'refund: the administrator records it');
select is(public.mark_attempt_refunded(
    (select id from public.payment_attempts where order_id = (select id from t_o) and attempt_number = 2),
    'WOMPI-DUP-1', 'Doble clic') ->> 'already_refunded',
  'true', 'refund: recording it again changes nothing');
select is(public.mark_attempt_refunded(
    (select id from public.payment_attempts where order_id = (select id from t_o) and attempt_number = 1),
    'WOMPI-DUP-2', 'Equivocado') ->> 'error',
  'attempt_not_refundable', 'refund: the payment that paid the order is not refundable');
reset role;

select pg_temp.as_customer();
set local role authenticated;
select throws_ok(
  $$select public.mark_attempt_refunded(gen_random_uuid(), 'WOMPI-X', 'Prueba')$$,
  '42501', null, 'permissions: a customer cannot record refunds');
reset role;

-- A payment for a cancelled order keeps D-040: the ORDER is marked for refund.
create temporary table t_c as select pg_temp.order_with_two_attempts() as id;
update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Prueba'
where id = (select id from t_c);
select pg_temp.apply('dup-3', pg_temp.event(
  (select reference from public.payment_attempts where order_id = (select id from t_c) and attempt_number = 2), 'APPROVED',
  (select amount_in_cents from public.payment_attempts where order_id = (select id from t_c) and attempt_number = 2), 'tx-dup-3'));
select results_eq(
  $$select needs_refund, refund_reason from public.orders where id = (select id from t_c)$$,
  $$values (true, 'payment_for_closed_order')$$,
  'cancelled: the first late payment marks the order for refund (D-040)'
);
select throws_ok(
  $$update public.payment_attempts set refund_needed = true, refund_reason = 'duplicate_payment'
    where order_id = (select id from t_c) and attempt_number = 1$$,
  '23514', null, 'constraint: only an approved attempt can be marked for refund'
);
-- A second late payment for the same cancelled order is not lost.
select pg_temp.apply('dup-4', pg_temp.event(
  (select reference from public.payment_attempts where order_id = (select id from t_c) and attempt_number = 1), 'APPROVED',
  (select amount_in_cents from public.payment_attempts where order_id = (select id from t_c) and attempt_number = 1), 'tx-dup-4'));
select is(
  (select refund_needed from public.payment_attempts where order_id = (select id from t_c) and attempt_number = 1),
  true, 'cancelled: a second late payment is marked on its attempt, never lost');

grant select on t_c to authenticated;
select pg_temp.as_admin();
set local role authenticated;
select is(
  (select r ->> 'transaction_id' from jsonb_array_elements(public.admin_list_refunds()) r
   where r ->> 'kind' = 'order' and r ->> 'order_id' = (select id::text from t_c)),
  'tx-dup-3', 'panel: the order row shows the payment that paid it, not the duplicate');
reset role;

select * from finish();
rollback;
