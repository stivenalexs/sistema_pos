-- Tests for failed deliveries (plan step 18b-1, D-068): back to the store,
-- the customer's choice, rescheduling, emails and pickups to resolve.
-- Run with `npm run db:test`. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('d3000000-0000-4000-8000-000000000001', 'admin18b@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}'),
  ('d3000000-0000-4000-8000-000000000002', 'caja18b@test.local', 'authenticated', 'authenticated', '{"staff_role":"cashier"}'),
  ('d3000000-0000-4000-8000-000000000003', 'moto18b@test.local', 'authenticated', 'authenticated', '{"staff_role":"courier"}'),
  ('d3000000-0000-4000-8000-000000000004', 'cliente18b@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('d3000000-0000-4000-8000-000000000005', 'otro18b@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('d3000000-0000-4000-8000-000000000006', 'empresa18b@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');
insert into public.customers (id, customer_type, wholesale_status, full_name, document_type, document_number) values
  ('d3000000-0000-4000-8000-000000000004', 'retail', null, 'Cliente 18b', null, null),
  ('d3000000-0000-4000-8000-000000000005', 'retail', null, 'Otro 18b', null, null),
  ('d3000000-0000-4000-8000-000000000006', 'wholesale', 'approved', 'Empresa 18b', 'nit', '9001234568');
insert into public.couriers (id, provider_id, full_name)
  select 'd3000000-0000-4000-8000-000000000003', id, 'Moto 18b' from public.delivery_providers where kind = 'own';

create function pg_temp.as_user(p_id text, p_meta text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":' || p_meta || '}', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.as_user('d3000000-0000-4000-8000-000000000001', '{"staff_role":"admin"}');
$$;
create function pg_temp.as_cashier() returns void language sql as $$
  select pg_temp.as_user('d3000000-0000-4000-8000-000000000002', '{"staff_role":"cashier"}');
$$;
create function pg_temp.as_courier() returns void language sql as $$
  select pg_temp.as_user('d3000000-0000-4000-8000-000000000003', '{"staff_role":"courier"}');
$$;
create function pg_temp.as_c1() returns void language sql as $$
  select pg_temp.as_user('d3000000-0000-4000-8000-000000000004', '{"customer_type":"retail"}');
$$;
create function pg_temp.as_c2() returns void language sql as $$
  select pg_temp.as_user('d3000000-0000-4000-8000-000000000005', '{"customer_type":"retail"}');
$$;
create function pg_temp.as_w() returns void language sql as $$
  select pg_temp.as_user('d3000000-0000-4000-8000-000000000006', '{"customer_type":"wholesale","wholesale_approved":true}');
$$;

-- A paid web delivery order ($45.000 + $6.000 delivery), assigned to the courier.
create function pg_temp.order_on_the_way(p_id uuid, p_customer uuid) returns void language plpgsql as $$
begin
  insert into public.orders (id, customer_id, channel, status, fulfillment, sale_unit, subtotal_cop, delivery_fee_cop,
    total_cop, total_base_units, idempotency_key, delivery_address, delivery_distance_m)
  values (p_id, p_customer, 'web', 'awaiting_payment', 'delivery', 'unit', 45000, 6000, 51000, 1, gen_random_uuid(),
    jsonb_build_object('municipality', 'Medellín', 'address_line', 'Calle 10 # 43-20', 'contact_name', 'Cliente',
                       'contact_phone', '3001234567', 'lat', 6.25, 'lng', -75.57),
    948);
  update public.orders set status = 'paid', paid_at = now() where id = p_id;
  update public.orders
  set status = 'out_for_delivery', assigned_at = now(), courier_id = 'd3000000-0000-4000-8000-000000000003',
      delivery_provider_id = (select id from public.delivery_providers where kind = 'own')
  where id = p_id;
end $$;
-- The courier records a failed attempt (as the worker does).
create function pg_temp.fail(p_order uuid, p_reason text, p_key uuid default gen_random_uuid()) returns jsonb language sql as $$
  select public.record_delivery_attempt(p_key, p_order, 'd3000000-0000-4000-8000-000000000003', 'failed',
    null, null, null, null, p_reason, 'Prueba');
$$;
create function pg_temp.emails(p_order uuid, p_template text) returns integer language sql as $$
  select count(*)::int from public.actions
  where type = 'send_email' and payload ->> 'order_id' = p_order::text and payload ->> 'template' = p_template;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.order_on_the_way('d4000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000004'); -- customer side
select pg_temp.order_on_the_way('d4000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000004'); -- force majeure
select pg_temp.order_on_the_way('d4000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000004'); -- under 18
select pg_temp.order_on_the_way('d4000000-0000-4000-8000-000000000004', 'd3000000-0000-4000-8000-000000000004'); -- chooses refund
select pg_temp.order_on_the_way('d4000000-0000-4000-8000-000000000005', 'd3000000-0000-4000-8000-000000000004'); -- chooses a new delivery
select pg_temp.order_on_the_way('d4000000-0000-4000-8000-000000000006', 'd3000000-0000-4000-8000-000000000004'); -- chooses pickup
select pg_temp.order_on_the_way('d4000000-0000-4000-8000-000000000007', 'd3000000-0000-4000-8000-000000000004'); -- no choice in 3 days
select pg_temp.order_on_the_way('d4000000-0000-4000-8000-000000000008', 'd3000000-0000-4000-8000-000000000006'); -- NIT customer

-- ---------------------------------------------------------------------------
-- Failure reasons and the return to the store
-- ---------------------------------------------------------------------------

select is(pg_temp.fail('d4000000-0000-4000-8000-000000000001', 'stolen_by_aliens') ->> 'error',
  'invalid_failure_reason', 'reason: an unknown reason is refused');

create temporary table t_key as select gen_random_uuid() as k;
select is(pg_temp.fail('d4000000-0000-4000-8000-000000000001', 'inaccessible_location', (select k from t_key)) ->> 'outcome',
  'failed', 'customer: a failed attempt for an inaccessible place is recorded');
select results_eq(
  $$select status::text, delivery_return_kind, courier_id is null, assigned_at is null,
           return_choice_deadline between now() + interval '71 hours' and now() + interval '73 hours'
    from public.orders where id = 'd4000000-0000-4000-8000-000000000001'$$,
  $$values ('preparing', 'customer', true, true, true)$$,
  'customer: the order returns to the store, unassigned, with 3 days to choose'
);
select is(pg_temp.emails('d4000000-0000-4000-8000-000000000001', 'delivery_customer'), 1,
  'customer: one email is queued');
select is(pg_temp.fail('d4000000-0000-4000-8000-000000000001', 'inaccessible_location', (select k from t_key)) ->> 'duplicate',
  'true', 'customer: the same attempt again is not recorded twice');
select is(pg_temp.emails('d4000000-0000-4000-8000-000000000001', 'delivery_customer'), 1,
  'customer: nor emailed twice');

select pg_temp.fail('d4000000-0000-4000-8000-000000000002', 'weather_or_disaster');
select results_eq(
  $$select status::text, delivery_return_kind, scheduled_delivery_on = private.bogota_tomorrow(), return_choice_deadline is null
    from public.orders where id = 'd4000000-0000-4000-8000-000000000002'$$,
  $$values ('preparing', 'force_majeure', true, true)$$,
  'force majeure: rescheduled for tomorrow in Colombia, no choice asked'
);
select is(pg_temp.emails('d4000000-0000-4000-8000-000000000002', 'delivery_force_majeure'), 1,
  'force majeure: the customer is emailed');

select pg_temp.fail('d4000000-0000-4000-8000-000000000003', 'recipient_underage');
select results_eq(
  $$select status::text, needs_refund, refund_reason, refund_amount_cop
    from public.orders where id = 'd4000000-0000-4000-8000-000000000003'$$,
  $$values ('preparing', true, 'recipient_underage', 45000::bigint)$$,
  'underage: back to the store and marked for a refund of the products only'
);
select is(pg_temp.emails('d4000000-0000-4000-8000-000000000003', 'delivery_underage'), 1,
  'underage: the customer is emailed');

select pg_temp.fail(id, 'recipient_absent') from unnest(array[
  'd4000000-0000-4000-8000-000000000004', 'd4000000-0000-4000-8000-000000000005',
  'd4000000-0000-4000-8000-000000000006', 'd4000000-0000-4000-8000-000000000007',
  'd4000000-0000-4000-8000-000000000008']::uuid[]) as id;

select pg_temp.as_courier();
set local role authenticated;
select is_empty($$select id from public.orders where id = 'd4000000-0000-4000-8000-000000000001'$$,
  'courier: the returned order is no longer theirs');
reset role;

-- ---------------------------------------------------------------------------
-- The panel
-- ---------------------------------------------------------------------------

select pg_temp.as_admin();
set local role authenticated;
select results_eq(
  $$select d ->> 'order_id', d ->> 'awaiting_choice', d ->> 'scheduled_delivery_on' is not null
    from jsonb_array_elements(public.admin_list_deliveries()) d
    where d ->> 'order_id' in ('d4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002')
    order by 1$$,
  $$values ('d4000000-0000-4000-8000-000000000001', 'true', false),
           ('d4000000-0000-4000-8000-000000000002', 'false', true)$$,
  'panel: waiting for the customer, and rescheduled with its day'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.admin_list_deliveries()) d
   where d ->> 'order_id' = 'd4000000-0000-4000-8000-000000000003'),
  0, 'panel: an order to refund is not in the deliveries'
);
select is((public.admin_summary() ->> 'deliveries_failed')::int, 6,
  'summary: six orders wait for the customer''s choice');
select throws_ok(
  $$select public.assign_delivery('d4000000-0000-4000-8000-000000000001',
      (select id from public.delivery_providers where kind = 'own'), 'd3000000-0000-4000-8000-000000000003')$$,
  '22023', 'delivery_awaiting_customer_choice', 'panel: an order waiting for the customer cannot be assigned'
);
select lives_ok(
  $$select public.assign_delivery('d4000000-0000-4000-8000-000000000002',
      (select id from public.delivery_providers where kind = 'own'), 'd3000000-0000-4000-8000-000000000003')$$,
  'panel: a rescheduled order is assigned again'
);
select is(public.mark_order_refunded('d4000000-0000-4000-8000-000000000003', 'WOMPI-123', 'Menor de edad') ->> 'ok',
  'true', 'refund: a refund of the products only is recorded since step 18b-2 (D-069)');
reset role;

-- ---------------------------------------------------------------------------
-- The customer's choice
-- ---------------------------------------------------------------------------

set local role anon;
select throws_ok($$select public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000004', 'refund')$$,
  '42501', null, 'choice: a visitor cannot call it');
reset role;

select pg_temp.as_c2();
set local role authenticated;
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000004', 'refund') ->> 'error',
  'order_not_found', 'choice: another customer cannot choose');
reset role;

select pg_temp.as_c1();
set local role authenticated;
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000004', 'teleport') ->> 'error',
  'invalid_option', 'choice: an unknown option is refused');
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000002', 'refund') ->> 'error',
  'not_awaiting_choice', 'choice: not for a force majeure return');
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000004', 'refund') ->> 'ok',
  'true', 'refund: the customer chooses the refund');
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000004', 'refund') ->> 'already_chosen',
  'true', 'refund: the same choice again answers the same');
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000004', 'pickup', '1020304050') ->> 'error',
  'choice_already_made', 'refund: another choice afterwards is refused');
reset role;
select results_eq(
  $$select needs_refund, refund_reason, refund_amount_cop, return_choice
    from public.orders where id = 'd4000000-0000-4000-8000-000000000004'$$,
  $$values (true, 'customer_chose_refund', 45000::bigint, 'refund')$$,
  'refund: marked for a refund of the products only'
);

select pg_temp.as_c1();
set local role authenticated;
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000005', 'reschedule') ->> 'ok',
  'true', 'reschedule: the customer asks for a new delivery');
reset role;
select results_eq(
  $$select fulfillment::text, delivery_fee_cop, total_cop, scheduled_delivery_on = private.bogota_tomorrow()
    from public.orders where id = 'd4000000-0000-4000-8000-000000000005'$$,
  $$values ('delivery', 6000::bigint, 51000::bigint, true)$$,
  'reschedule: tomorrow, without charging the delivery again'
);
select pg_temp.as_admin();
set local role authenticated;
select lives_ok(
  $$select public.assign_delivery('d4000000-0000-4000-8000-000000000005',
      (select id from public.delivery_providers where kind = 'own'), 'd3000000-0000-4000-8000-000000000003')$$,
  'reschedule: the administrator assigns it again'
);
reset role;

select pg_temp.as_c1();
set local role authenticated;
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000006', 'pickup') ->> 'error',
  'pickup_document_required', 'pickup: a retail customer gives the cédula of who picks it up');
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000006', 'pickup', '43.123.456') ->> 'ok',
  'true', 'pickup: chosen with the cédula');
select is(public.get_pickup_status('d4000000-0000-4000-8000-000000000006'),
  '{"locked": false, "needs_document": false, "document_last3": "456"}'::jsonb,
  'pickup: the order is now a pickup with the cédula ending in 456');
select is(public.confirm_pickup('d4000000-0000-4000-8000-000000000006', '43123456') ->> 'ok',
  'true', 'pickup: then "Recogí mi pedido" delivers it');
reset role;

select pg_temp.as_w();
set local role authenticated;
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000008', 'pickup') ->> 'ok',
  'true', 'pickup: a NIT customer chooses pickup without a cédula');
reset role;

-- ---------------------------------------------------------------------------
-- Three days without a choice
-- ---------------------------------------------------------------------------

update public.orders set return_choice_deadline = now() - interval '1 minute'
where id = 'd4000000-0000-4000-8000-000000000007';
select pg_temp.as_c1();
set local role authenticated;
select is(public.choose_delivery_return_option('d4000000-0000-4000-8000-000000000007', 'reschedule') ->> 'error',
  'choice_expired', 'deadline: no choice after 3 days');
select throws_ok($$select public.apply_expired_return_choices()$$, '42501', null,
  'deadline: a customer cannot run the job');
reset role;

select is(public.apply_expired_return_choices(), 1, 'deadline: the job applies pickup to the expired order');
select results_eq(
  $$select fulfillment::text, return_choice, return_choice_defaulted
    from public.orders where id = 'd4000000-0000-4000-8000-000000000007'$$,
  $$values ('pickup', 'pickup', true)$$,
  'deadline: the order stays for pickup at the store'
);

select pg_temp.as_admin();
set local role authenticated;
select is(
  (select p ->> 'reason' from jsonb_array_elements(public.admin_list_pickups_attention()) p
   where p ->> 'order_id' = 'd4000000-0000-4000-8000-000000000007'),
  'missing_document', 'pickups: the store sees it has no cédula yet'
);
select is((public.admin_summary() ->> 'pickups_attention')::int, 1, 'summary: one pickup to resolve');
reset role;

select pg_temp.as_c1();
set local role authenticated;
select is(public.get_pickup_status('d4000000-0000-4000-8000-000000000007') ->> 'needs_document', 'true',
  'pickups: the customer is asked for the cédula');
select is(public.set_pickup_document('d4000000-0000-4000-8000-000000000007', '1a') ->> 'error',
  'invalid_pickup_document', 'pickups: a malformed cédula is refused');
select is(public.set_pickup_document('d4000000-0000-4000-8000-000000000007', '1.020.304.050') ->> 'document_last3',
  '050', 'pickups: the customer gives the cédula');
select is(public.set_pickup_document('d4000000-0000-4000-8000-000000000007', '99999999') ->> 'error',
  'document_already_set', 'pickups: it cannot be changed afterwards');
reset role;

select pg_temp.as_admin();
set local role authenticated;
select is(jsonb_array_length(public.admin_list_pickups_attention()), 0, 'pickups: nothing left to resolve');
reset role;

-- Locked after five wrong documents: the administrator resets it with a reason.
update private.order_pickup_documents set failed_attempts = 5
where order_id = 'd4000000-0000-4000-8000-000000000007';
select pg_temp.as_cashier();
set local role authenticated;
select throws_ok($$select public.admin_reset_pickup_attempts('d4000000-0000-4000-8000-000000000007', 'Cliente verificado')$$,
  '42501', 'admin_forbidden', 'reset: a cashier cannot unlock a pickup');
reset role;
select pg_temp.as_admin();
set local role authenticated;
select is(
  (select p ->> 'reason' from jsonb_array_elements(public.admin_list_pickups_attention()) p
   where p ->> 'order_id' = 'd4000000-0000-4000-8000-000000000007'),
  'locked', 'reset: the panel shows the locked pickup'
);
select is(public.admin_reset_pickup_attempts('d4000000-0000-4000-8000-000000000007', 'x') ->> 'error',
  'invalid_reason', 'reset: a reason is required');
select is(public.admin_reset_pickup_attempts('d4000000-0000-4000-8000-000000000007', 'Cliente verificado en tienda') ->> 'changed',
  'true', 'reset: the administrator unlocks it');
reset role;
select is(
  (select reason from public.order_events where order_id = 'd4000000-0000-4000-8000-000000000007'
     and reason like 'Intentos de recogida%'),
  'Intentos de recogida reiniciados: Cliente verificado en tienda', 'reset: the reason is in the order history'
);

-- ---------------------------------------------------------------------------
-- Email data (server only)
-- ---------------------------------------------------------------------------

select pg_temp.as_c1();
set local role authenticated;
select throws_ok($$select public.order_email_data('d4000000-0000-4000-8000-000000000001')$$, '42501', null,
  'email: a customer cannot read the email data');
reset role;
select results_eq(
  $$select r ->> 'email', r ->> 'customer_name', r ->> 'failure_reason', r ? 'pickup_document'
    from (select public.order_email_data('d4000000-0000-4000-8000-000000000001') as r) s$$,
  $$values ('cliente18b@test.local', 'Cliente 18b', 'inaccessible_location', false)$$,
  'email: the worker gets the address, the name and the reason, never a cédula'
);

-- ---------------------------------------------------------------------------
-- External review (2026-11-21)
-- ---------------------------------------------------------------------------

-- History: who and why, also without a user session (worker, pg_cron).
select results_eq(
  $$select actor_id, reason like 'Entrega fallida: inaccessible_location — Prueba' from public.order_events
    where order_id = 'd4000000-0000-4000-8000-000000000001' and to_status = 'preparing'$$,
  $$values ('d3000000-0000-4000-8000-000000000003'::uuid, true)$$,
  'history: the failed delivery has the courier and the reason'
);
select is(
  (select count(*)::int from public.order_events where order_id = 'd4000000-0000-4000-8000-000000000004'
     and reason = 'El cliente eligió: el reembolso de los productos'),
  1, 'history: the customer''s choice is recorded'
);
select is(
  (select count(*)::int from public.order_events where order_id = 'd4000000-0000-4000-8000-000000000007'
     and reason like 'Sin elección del cliente en 3 días%'),
  1, 'history: the default after 3 days is recorded'
);

-- Refunds: products only even with a free delivery; a returned order becomes refunded.
update public.orders set delivery_fee_cop = 0, total_cop = 45000 where id = 'd4000000-0000-4000-8000-000000000003';
select pg_temp.as_admin();
set local role authenticated;
select is(public.mark_order_refunded('d4000000-0000-4000-8000-000000000003', 'WOMPI-124', 'Menor de edad') ->> 'already_refunded',
  'true', 'refund: recording a products-only refund twice changes nothing');
reset role;

select pg_temp.order_on_the_way('d4000000-0000-4000-8000-000000000009', 'd3000000-0000-4000-8000-000000000004');
select pg_temp.fail('d4000000-0000-4000-8000-000000000009', 'vehicle_breakdown');
update public.orders set needs_refund = true, refund_reason = 'insufficient_stock_after_payment'
where id = 'd4000000-0000-4000-8000-000000000009';
select pg_temp.as_admin();
set local role authenticated;
select is(public.mark_order_refunded('d4000000-0000-4000-8000-000000000009', 'WOMPI-125', 'Sin stock') ->> 'ok',
  'true', 'refund: a full refund of an order back at the store is recorded');
select is(
  (select r ->> 'refund_amount_cop' || ':' || (r ->> 'products_only') from jsonb_array_elements(public.admin_list_refunds()) r
   where r ->> 'order_id' = 'd4000000-0000-4000-8000-000000000004'),
  '45000:true', 'refund: the list shows the amount of the products'
);
reset role;
select is((select status::text from public.orders where id = 'd4000000-0000-4000-8000-000000000009'),
  'refunded', 'refund: the order back at the store becomes refunded');

-- Schema: the default is always pickup, and only a customer return has a deadline.
select throws_ok(
  $$update public.orders set return_choice_defaulted = true where id = 'd4000000-0000-4000-8000-000000000005'$$,
  '23514', null, 'constraint: only pickup can be the default'
);
select throws_ok(
  $$update public.orders set return_choice_deadline = now() where id = 'd4000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'constraint: a force majeure return has no deadline'
);

-- needs_document only while the cédula can still be given.
select pg_temp.order_on_the_way('d4000000-0000-4000-8000-000000000010', 'd3000000-0000-4000-8000-000000000004');
select pg_temp.fail('d4000000-0000-4000-8000-000000000010', 'refused');
update public.orders set return_choice_deadline = now() - interval '1 minute'
where id = 'd4000000-0000-4000-8000-000000000010';
select public.apply_expired_return_choices();
update public.orders set needs_refund = true, refund_reason = 'insufficient_stock_after_payment'
where id = 'd4000000-0000-4000-8000-000000000010';
select pg_temp.as_c1();
set local role authenticated;
select is(public.get_pickup_status('d4000000-0000-4000-8000-000000000010') ->> 'needs_document', 'false',
  'pickups: an order to refund does not ask for the cédula');
reset role;

select * from finish();
rollback;
