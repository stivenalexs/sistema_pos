-- Tests for products-only refunds (plan step 18b-2, D-069): stock back when
-- the refund is decided and a partial credit note when it is recorded.
-- Run with `npm run db:test`. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('d5000000-0000-4000-8000-000000000001', 'admin18b2@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}'),
  ('d5000000-0000-4000-8000-000000000003', 'moto18b2@test.local', 'authenticated', 'authenticated', '{"staff_role":"courier"}'),
  ('d5000000-0000-4000-8000-000000000004', 'cliente18b2@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');
insert into public.customers (id, customer_type, full_name) values
  ('d5000000-0000-4000-8000-000000000004', 'retail', 'Cliente 18b2');
insert into public.couriers (id, provider_id, full_name)
  select 'd5000000-0000-4000-8000-000000000003', id, 'Moto 18b2' from public.delivery_providers where kind = 'own';

create function pg_temp.as_user(p_id text, p_meta text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":' || p_meta || '}', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.as_user('d5000000-0000-4000-8000-000000000001', '{"staff_role":"admin"}');
$$;
create function pg_temp.as_customer() returns void language sql as $$
  select pg_temp.as_user('d5000000-0000-4000-8000-000000000004', '{"customer_type":"retail"}');
$$;

-- A paid web delivery order of 2 aguardientes ($90.000 + $6.000), on its way.
create function pg_temp.order_on_the_way(p_id uuid) returns void language plpgsql as $$
begin
  insert into public.orders (id, customer_id, channel, status, fulfillment, sale_unit, subtotal_cop, delivery_fee_cop,
    total_cop, total_base_units, idempotency_key, delivery_address, delivery_distance_m)
  values (p_id, 'd5000000-0000-4000-8000-000000000004', 'web', 'awaiting_payment', 'delivery', 'unit', 90000, 6000, 96000, 2,
    gen_random_uuid(),
    jsonb_build_object('municipality', 'Medellín', 'address_line', 'Calle 10 # 43-20', 'contact_name', 'Cliente',
                       'contact_phone', '3001234567', 'lat', 6.25, 'lng', -75.57),
    948);
  insert into public.order_items (order_id, product_id, sku, product_name, sale_unit, units_per_box, quantity,
    unit_price_cop, line_total_cop, base_units)
  values (p_id, '00000000-0000-4000-8000-000000000101', 'NAC-AGU-750', 'Aguardiente', 'unit', 12, 2, 45000, 90000, 2);
  update public.orders set status = 'paid', paid_at = now() where id = p_id;
  update public.orders
  set status = 'out_for_delivery', assigned_at = now(), courier_id = 'd5000000-0000-4000-8000-000000000003',
      delivery_provider_id = (select id from public.delivery_providers where kind = 'own')
  where id = p_id;
end $$;
create function pg_temp.fail(p_order uuid, p_reason text) returns jsonb language sql as $$
  select public.record_delivery_attempt(gen_random_uuid(), p_order, 'd5000000-0000-4000-8000-000000000003', 'failed',
    null, null, null, null, p_reason, null);
$$;
create function pg_temp.on_hand() returns integer language sql as $$
  select on_hand from public.product_stock where product_id = '00000000-0000-4000-8000-000000000101';
$$;
create function pg_temp.returned(p_order uuid) returns integer language sql as $$
  select coalesce(sum(units), 0)::int from public.inventory_movements
  where movement_type = 'return_in' and reference = p_order::text;
$$;
create function pg_temp.invoice(p_order uuid, p_status text) returns void language sql as $$
  insert into public.invoices (order_id, reference_code, status, customer, payment_method_code,
    total_cop, iva_cop, participation_cop, exploitation_cop, base_cop)
  values (p_order, 'INV-' || p_order, p_status::public.invoice_status, '{}'::jsonb, '48', 96000, 0, 0, 0, 96000);
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.order_on_the_way('d6100000-0000-4000-8000-000000000001'); -- under 18, invoice accepted
select pg_temp.order_on_the_way('d6100000-0000-4000-8000-000000000002'); -- customer chooses the refund
select pg_temp.order_on_the_way('d6100000-0000-4000-8000-000000000003'); -- customer reschedules
select pg_temp.order_on_the_way('d6100000-0000-4000-8000-000000000004'); -- invoice still being issued
select pg_temp.order_on_the_way('d6100000-0000-4000-8000-000000000005'); -- rejected invoice
create temporary table t_stock as select pg_temp.on_hand() as n;

-- ---------------------------------------------------------------------------
-- Stock back when the refund is decided
-- ---------------------------------------------------------------------------

select pg_temp.fail('d6100000-0000-4000-8000-000000000001', 'recipient_underage');
select is(pg_temp.returned('d6100000-0000-4000-8000-000000000001'), 2,
  'stock: an underage return puts the 2 bottles back');
select is(pg_temp.on_hand(), (select n + 2 from t_stock), 'stock: they can be sold again');

select pg_temp.fail(id, 'recipient_absent') from unnest(array[
  'd6100000-0000-4000-8000-000000000002', 'd6100000-0000-4000-8000-000000000003',
  'd6100000-0000-4000-8000-000000000004', 'd6100000-0000-4000-8000-000000000005']::uuid[]) as id;
select is(pg_temp.returned('d6100000-0000-4000-8000-000000000002'), 0,
  'stock: a customer-side return waits for the choice');

select pg_temp.as_customer();
set local role authenticated;
select public.choose_delivery_return_option('d6100000-0000-4000-8000-000000000002', 'refund');
select public.choose_delivery_return_option('d6100000-0000-4000-8000-000000000002', 'refund');
select public.choose_delivery_return_option('d6100000-0000-4000-8000-000000000003', 'reschedule');
select public.choose_delivery_return_option(id, 'refund') from unnest(array[
  'd6100000-0000-4000-8000-000000000004', 'd6100000-0000-4000-8000-000000000005']::uuid[]) as id;
reset role;
select is(pg_temp.returned('d6100000-0000-4000-8000-000000000002'), 2,
  'stock: choosing the refund puts the bottles back, once');
select is(pg_temp.returned('d6100000-0000-4000-8000-000000000003'), 0,
  'stock: a new delivery keeps them sold');
select is(
  (select count(*)::int from public.inventory_movements where reference = 'd6100000-0000-4000-8000-000000000002'
     and movement_type = 'return_in'),
  1, 'stock: one movement per product, never twice');
select is_empty($$select * from public.reconcile_stock()$$, 'stock: the balance matches the ledger');

-- ---------------------------------------------------------------------------
-- Recording the refund: a partial credit note
-- ---------------------------------------------------------------------------

select pg_temp.invoice('d6100000-0000-4000-8000-000000000001', 'accepted');
select pg_temp.invoice('d6100000-0000-4000-8000-000000000004', 'sent');
select pg_temp.invoice('d6100000-0000-4000-8000-000000000005', 'rejected');
-- A rejected invoice: its issue_invoice job ended (failed).
update public.actions set status = 'failed'
where idempotency_key = private.uuid_from_text('issue_invoice:d6100000-0000-4000-8000-000000000005');

select pg_temp.as_admin();
set local role authenticated;
select is(public.mark_order_refunded('d6100000-0000-4000-8000-000000000004', 'WOMPI-1', 'Productos') ->> 'error',
  'invoice_in_progress', 'refund: waits while the invoice is being issued');
create temporary table t_refund as
  select public.mark_order_refunded('d6100000-0000-4000-8000-000000000001', 'WOMPI-2', 'Menor de edad') as r;
select is((select r ->> 'ok' from t_refund), 'true', 'refund: a products-only refund is recorded');
select is(public.mark_order_refunded('d6100000-0000-4000-8000-000000000001', 'WOMPI-2', 'Menor de edad') ->> 'already_refunded',
  'true', 'refund: recording it again changes nothing');
select is(public.mark_order_refunded('d6100000-0000-4000-8000-000000000005', 'WOMPI-3', 'Productos') ->> 'credit_note_id',
  null, 'refund: a rejected invoice gets no credit note');
select is(public.mark_order_refunded('d6100000-0000-4000-8000-000000000002', 'WOMPI-4', 'Productos') ->> 'credit_note_id',
  null, 'refund: without an invoice there is no credit note');
reset role;

select results_eq(
  $$select n.kind, n.concept_code, n.reason from public.credit_notes n
    join public.invoices i on i.id = n.invoice_id where i.order_id = 'd6100000-0000-4000-8000-000000000001'$$,
  $$values ('products_only', '1', 'Reembolso: Menor de edad')$$,
  'credit note: partial, concept 1 (devolución parcial de los bienes)'
);
select is(
  (select count(*)::int from public.actions where type = 'issue_credit_note'
     and payload ->> 'credit_note_id' = (select r ->> 'credit_note_id' from t_refund)),
  1, 'credit note: queued for Factus'
);
select results_eq(
  $$select status::text, refund_reference, refunded_at is not null from public.orders
    where id = 'd6100000-0000-4000-8000-000000000001'$$,
  $$values ('refunded', 'WOMPI-2', true)$$,
  'refund: the order is refunded with its reference'
);
select is(
  (select count(*)::int from public.credit_notes n join public.invoices i on i.id = n.invoice_id
   where i.order_id = 'd6100000-0000-4000-8000-000000000004'),
  0, 'refund: nothing was created while waiting'
);
select is(pg_temp.returned('d6100000-0000-4000-8000-000000000001'), 2,
  'refund: recording it does not return the stock again');

-- A whole refund still annuls the invoice (concept 2).
select pg_temp.order_on_the_way('d6100000-0000-4000-8000-000000000006');
select pg_temp.fail('d6100000-0000-4000-8000-000000000006', 'vehicle_breakdown');
update public.orders set needs_refund = true, refund_reason = 'insufficient_stock_after_payment'
where id = 'd6100000-0000-4000-8000-000000000006';
select pg_temp.invoice('d6100000-0000-4000-8000-000000000006', 'accepted');
select pg_temp.as_admin();
set local role authenticated;
select is(public.mark_order_refunded('d6100000-0000-4000-8000-000000000006', 'WOMPI-5', 'Sin stock') ->> 'ok',
  'true', 'full: a whole refund is recorded');
reset role;
select results_eq(
  $$select n.kind, n.concept_code from public.credit_notes n
    join public.invoices i on i.id = n.invoice_id where i.order_id = 'd6100000-0000-4000-8000-000000000006'$$,
  $$values ('full', '2')$$,
  'full: the credit note annuls the invoice (concept 2)'
);
select is(pg_temp.returned('d6100000-0000-4000-8000-000000000006'), 0,
  'full: no stock comes back for a refund without the bottles');

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

select throws_ok(
  $$update public.credit_notes set concept_code = '2'
    where invoice_id = (select id from public.invoices where order_id = 'd6100000-0000-4000-8000-000000000001')$$,
  '23514', null, 'constraint: a products-only note is always concept 1'
);
select pg_temp.as_customer();
set local role authenticated;
select throws_ok($$select private.request_credit_note_kind(gen_random_uuid(), 'x', 'full')$$, '42501', null,
  'permissions: a customer cannot ask for a credit note');
select throws_ok($$select private.return_order_stock(gen_random_uuid(), 'x', null)$$, '42501', null,
  'permissions: a customer cannot return stock');
reset role;
-- Called by the server (mark_order_refunded runs as its owner).
select pg_temp.as_admin();
select throws_ok(
  $$select private.request_credit_note_kind((select id from public.invoices where order_id = 'd6100000-0000-4000-8000-000000000005'), 'x', 'refund_all')$$,
  '22023', 'credit_note_invalid_kind', 'guard: an unknown kind is refused'
);


-- ---------------------------------------------------------------------------
-- External review (2026-11-21)
-- ---------------------------------------------------------------------------

-- A whole refund also waits while the invoice is being issued...
select pg_temp.order_on_the_way('d6100000-0000-4000-8000-000000000007');
select pg_temp.fail('d6100000-0000-4000-8000-000000000007', 'vehicle_breakdown');
update public.orders set needs_refund = true, refund_reason = 'insufficient_stock_after_payment'
where id = 'd6100000-0000-4000-8000-000000000007';
select pg_temp.invoice('d6100000-0000-4000-8000-000000000007', 'pending');
select pg_temp.as_admin();
set local role authenticated;
select is(public.mark_order_refunded('d6100000-0000-4000-8000-000000000007', 'WOMPI-6', 'Sin stock') ->> 'error',
  'invoice_in_progress', 'review: a whole refund waits while its invoice job is queued');
reset role;
-- ...but not forever: once the job ended, a pending invoice does not block it.
update public.actions set status = 'failed'
where idempotency_key = private.uuid_from_text('issue_invoice:d6100000-0000-4000-8000-000000000007');
select pg_temp.as_admin();
set local role authenticated;
select is(public.mark_order_refunded('d6100000-0000-4000-8000-000000000007', 'WOMPI-6', 'Sin stock') ->> 'ok',
  'true', 'review: with the job ended the refund is recorded');
select is(
  (select n ->> 'kind' from jsonb_array_elements(public.admin_list_invoices() -> 'credit_notes') n
   where n ->> 'reason' = 'Reembolso: Menor de edad'),
  'products_only', 'review: the invoices page says the credit note is partial'
);
reset role;

-- A credit note of the other kind is never returned as if it were the one asked for.
select pg_temp.as_admin();
select throws_ok(
  $$select private.request_credit_note_kind((select id from public.invoices where order_id = 'd6100000-0000-4000-8000-000000000001'), 'x', 'full')$$,
  '22023', 'credit_note_kind_conflict', 'review: asking for a full note when a partial one exists is an error'
);
select is(
  private.request_credit_note_kind((select id from public.invoices where order_id = 'd6100000-0000-4000-8000-000000000001'), 'x', 'products_only'),
  (select n.id from public.credit_notes n join public.invoices i on i.id = n.invoice_id
   where i.order_id = 'd6100000-0000-4000-8000-000000000001'),
  'review: asking again for the same kind returns the same note'
);

select * from finish();
rollback;
