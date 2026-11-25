-- One definition for each "needs attention" rule: the summary and the lists
-- of the panel always agree, and the pickup limit lives in one place
-- (thermos quality finding 2, D-071; D-076). Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('ea000000-0000-4000-8000-000000000001', 'crit@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('ea000000-0000-4000-8000-000000000021', 'crit-admin@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}');
insert into public.customers (id, customer_type, full_name) values
  ('ea000000-0000-4000-8000-000000000001', 'retail', 'Crit');

create function pg_temp.as_customer() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"ea000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"ea000000-0000-4000-8000-000000000021","role":"authenticated","app_metadata":{"staff_role":"admin"}}', true);
$$;
create function pg_temp.pickup_order() returns uuid language plpgsql as $$
begin
  perform public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
  return (public.place_order(gen_random_uuid(), 'pickup', null, '1020304050') ->> 'order_id')::uuid;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------------------------------------------------------------------------
-- The rules themselves
-- ---------------------------------------------------------------------------

select is(private.pickup_max_attempts(), 5, 'limit: five wrong documents');
select is(
  array[private.pickup_locked(null), private.pickup_locked(4), private.pickup_locked(5)],
  array[false, false, true], 'limit: locked from the fifth wrong document'
);

select pg_temp.as_customer();
set local role authenticated;
select throws_ok($$select * from private.pickups_needing_attention$$, '42501', null,
  'privacy: a customer cannot read the panel views');
select throws_ok($$select private.pickup_locked(9)$$, '42501', null,
  'privacy: a customer cannot call the private rules');

-- Fixtures: a locked pickup, an order to refund and a rejected invoice.
create temporary table t_orders (name text primary key, id uuid);
grant all on t_orders to authenticated;
insert into t_orders values ('locked', pg_temp.pickup_order()), ('refund', pg_temp.pickup_order());
reset role;

update public.orders set status = 'paid', paid_at = now() where id in (select id from t_orders);
update public.orders set needs_refund = true, refund_reason = 'insufficient_stock_after_payment'
where id = (select id from t_orders where name = 'refund');
update private.order_pickup_documents set failed_attempts = 5
where order_id = (select id from t_orders where name = 'locked');
select public.prepare_invoice((select id from t_orders where name = 'locked'));
update public.invoices set status = 'rejected', last_error = '422: prueba'
where order_id = (select id from t_orders where name = 'locked');

delete from pgmq.q_actions;
update public.actions set status = 'succeeded', finished_at = now() where status in ('queued', 'processing');
create temporary table t_late as
  select * from public.enqueue_action(gen_random_uuid(), 'noop', 'ea000000-0000-4000-8000-000000000001', '{}');
update public.actions set created_at = now() - interval '11 minutes' where id = (select tracking_id from t_late);
grant select on t_late to authenticated;

-- ---------------------------------------------------------------------------
-- The summary and the lists agree
-- ---------------------------------------------------------------------------

select pg_temp.as_admin();
set local role authenticated;
create temporary table t_summary as select public.admin_summary() as s;

select is((select (s ->> 'pickups_attention')::int from t_summary), jsonb_array_length(public.admin_list_pickups_attention()),
  'pickups: the counter and the list agree');
select is(public.admin_list_pickups_attention() -> 0 ->> 'reason', 'locked',
  'pickups: the locked one is listed as locked (the order to refund is not)');
select is((select (s ->> 'refunds_pending')::int from t_summary), jsonb_array_length(public.admin_list_refunds()),
  'refunds: the counter and the list agree');
select is((select (s ->> 'refunds_pending')::int from t_summary), 1, 'refunds: one order to refund');
select is(
  (select (s ->> 'invoices_attention')::int from t_summary),
  (select count(*)::int from jsonb_array_elements(public.admin_list_invoices() -> 'invoices') i
   where i ->> 'status' = 'rejected' or i ->> 'action_status' = 'failed'),
  'invoices: the counter counts the rejected ones of the list'
);
select is((select (s ->> 'invoices_attention')::int from t_summary), 1, 'invoices: one rejected');
select is(
  (select (s ->> 'queue_stuck')::int from t_summary),
  (public.admin_queue_status() ->> 'overdue')::int + (public.admin_queue_status() ->> 'stalled')::int,
  'queue: the summary counts what the queue page counts'
);
select is((select (s ->> 'queue_stuck')::int from t_summary), 1, 'queue: one action overdue');
reset role;

select pg_temp.as_customer();
set local role authenticated;
select is(public.confirm_pickup((select id from t_orders where name = 'locked'), '1020304050') ->> 'error', 'pickup_locked',
  'confirm: the customer is locked by the same limit');
reset role;

-- ---------------------------------------------------------------------------
-- One place: changing the limit changes every reader
-- ---------------------------------------------------------------------------

create or replace function private.pickup_max_attempts() returns integer language sql immutable set search_path = '' as $$
  select 6;
$$;

select pg_temp.as_admin();
set local role authenticated;
select is((public.admin_summary() ->> 'pickups_attention')::int, 0, 'one place: the summary follows the new limit');
select is(jsonb_array_length(public.admin_list_pickups_attention()), 0, 'one place: the list follows it too');
reset role;

select pg_temp.as_customer();
set local role authenticated;
select is(public.get_pickup_status((select id from t_orders where name = 'locked')) ->> 'locked', 'false',
  'one place: the customer page follows it too');
reset role;

select * from finish();
rollback;
