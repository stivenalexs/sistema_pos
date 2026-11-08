-- Tests for the admin panel, part B (plan step 17b, D-055). Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('c8000000-0000-4000-8000-000000000001', 'cliente17b@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('c8000000-0000-4000-8000-000000000021', 'admin17b@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}');
insert into public.customers (id, customer_type, full_name) values
  ('c8000000-0000-4000-8000-000000000001', 'retail', 'Cliente 17b');

create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"c8000000-0000-4000-8000-000000000021","role":"authenticated","app_metadata":{"staff_role":"admin"}}', true);
$$;
create function pg_temp.as_customer() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"c8000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
$$;
-- A paid web order of one aguardiente (45.000); paying enqueues its invoice.
create function pg_temp.paid_order(p_id uuid) returns void language plpgsql as $$
begin
  insert into public.orders (id, customer_id, channel, status, fulfillment, sale_unit, subtotal_cop, total_cop, total_base_units, idempotency_key)
  values (p_id, 'c8000000-0000-4000-8000-000000000001', 'web', 'awaiting_payment', 'pickup', 'unit', 45000, 45000, 1, gen_random_uuid());
  insert into public.order_items (order_id, product_id, sku, product_name, sale_unit, units_per_box, quantity, unit_price_cop, line_total_cop, base_units)
  values (p_id, '00000000-0000-4000-8000-000000000101', 'NAC-AGU-750', 'Aguardiente', 'unit', 12, 1, 45000, 45000, 1);
  update public.orders set status = 'paid', paid_at = now() where id = p_id;
end $$;
create function pg_temp.invoice_action(p_order uuid) returns public.actions language sql security definer as $$
  select * from public.actions where idempotency_key = private.uuid_from_text('issue_invoice:' || p_order::text);
$$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.paid_order('c9000000-0000-4000-8000-000000000001');
select pg_temp.paid_order('c9000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

select pg_temp.as_customer();
set local role authenticated;
select throws_ok($$select public.retry_action(gen_random_uuid(), 'Prueba')$$, '42501', 'admin_forbidden', 'perm: a customer cannot retry');
select throws_ok($$select public.admin_queue_status()$$, '42501', 'admin_forbidden', 'perm: a customer cannot see the queue');
select throws_ok($$select public.mark_order_refunded(gen_random_uuid(), 'WOMPI-1', 'Prueba')$$, '42501', 'admin_forbidden',
  'perm: a customer cannot record refunds');
reset role;

-- ---------------------------------------------------------------------------
-- Failed actions
-- ---------------------------------------------------------------------------

select pg_temp.as_admin();
set local role authenticated;
select is(public.retry_action((pg_temp.invoice_action('c9000000-0000-4000-8000-000000000001')).id, 'Prueba') ->> 'error',
  'action_not_failed', 'retry: only failed actions');
reset role;

-- The worker gave up on both invoices.
update public.actions set status = 'failed', error = 'invoice_rejected_422', attempts = 1, finished_at = now()
where idempotency_key in (private.uuid_from_text('issue_invoice:c9000000-0000-4000-8000-000000000001'),
                          private.uuid_from_text('issue_invoice:c9000000-0000-4000-8000-000000000002'));

select pg_temp.as_admin();
set local role authenticated;
select is((public.admin_queue_status() ->> 'failed_count')::int, 2, 'queue: failed actions are listed');
select is(public.retry_action((pg_temp.invoice_action('c9000000-0000-4000-8000-000000000002')).id, 'x') ->> 'error',
  'invalid_reason', 'retry: a reason is required');
select is(public.retry_action((pg_temp.invoice_action('c9000000-0000-4000-8000-000000000002')).id, 'Se corrigió la configuración') ->> 'ok',
  'true', 'retry: a failed action goes back to the queue');
reset role;
select is(
  (select status::text || ':' || attempts || ':' || (error is null) || ':' || (queue_msg_id is not null)
   from pg_temp.invoice_action('c9000000-0000-4000-8000-000000000002')),
  'queued:0:true:true', 'retry: queued again with a new message and no error'
);
select is((select previous_error || ':' || reason from public.action_retries),
  'invoice_rejected_422:Se corrigió la configuración', 'retry: recorded in the history');
select throws_ok($$update public.action_retries set reason = 'otra'$$, '42501', null, 'retry: the history cannot be changed');

-- ---------------------------------------------------------------------------
-- Rejected invoices
-- ---------------------------------------------------------------------------

select public.prepare_invoice('c9000000-0000-4000-8000-000000000001');
select public.record_invoice_result((select id from public.invoices where order_id = 'c9000000-0000-4000-8000-000000000001'),
  'rejected', '{}'::jsonb, '{"message":"Rango de numeración vencido"}'::jsonb, '422: Rango de numeración vencido');

select pg_temp.as_admin();
set local role authenticated;
select is((select i ->> 'response_message' from jsonb_array_elements(public.admin_list_invoices() -> 'invoices') i
           where i ->> 'order_id' = 'c9000000-0000-4000-8000-000000000001'),
  'Rango de numeración vencido', 'invoices: the rejection reason is shown');
select is(public.retry_invoice((select id from public.invoices where order_id = 'c9000000-0000-4000-8000-000000000001'),
                               'Rango renovado en Factus') ->> 'ok', 'true', 'invoice: a rejected invoice is retried');
reset role;
select is(
  (select i.status::text || ':' || (i.last_error is null) || ':' || a.status
   from public.invoices i, pg_temp.invoice_action(i.order_id) a where i.order_id = 'c9000000-0000-4000-8000-000000000001'),
  'pending:true:queued', 'invoice: back to pending with its action queued (same reference)'
);

update public.invoices set status = 'accepted' where order_id = 'c9000000-0000-4000-8000-000000000001';
select pg_temp.as_admin();
set local role authenticated;
select is(public.retry_invoice((select id from public.invoices where order_id = 'c9000000-0000-4000-8000-000000000001'), 'Prueba') ->> 'error',
  'invoice_accepted', 'invoice: an accepted invoice is never retried');
reset role;

-- A rejected credit note of that (now accepted) invoice is retried too.
select pg_temp.as_admin();
set local role authenticated;
select public.request_credit_note((select id from public.invoices where order_id = 'c9000000-0000-4000-8000-000000000001'), 'Devolución de prueba');
reset role;
update public.credit_notes set status = 'rejected', last_error = '422: concepto inválido';
update public.actions set status = 'failed', error = 'credit_note_rejected_422', finished_at = now() where type = 'issue_credit_note';
select pg_temp.as_admin();
set local role authenticated;
select is(public.retry_credit_note((select id from public.credit_notes), 'Concepto corregido') ->> 'ok', 'true',
  'credit note: a rejected one is retried');
reset role;
select is((select n.status::text || ':' || a.status from public.credit_notes n, public.actions a where a.type = 'issue_credit_note'),
  'pending:queued', 'credit note: back to pending with its action queued');
update public.credit_notes set status = 'accepted';
select pg_temp.as_admin();
set local role authenticated;
select is(jsonb_array_length(public.admin_list_invoices() -> 'credit_notes'), 0, 'credit note: accepted ones are not listed');
reset role;

-- The summary counts an invoice stuck in "sent" whose job stopped, like the list.
select pg_temp.paid_order('c9000000-0000-4000-8000-000000000004');
select public.prepare_invoice('c9000000-0000-4000-8000-000000000004');
update public.invoices set status = 'sent' where order_id = 'c9000000-0000-4000-8000-000000000004';
update public.actions set status = 'failed', finished_at = now()
where idempotency_key = private.uuid_from_text('issue_invoice:c9000000-0000-4000-8000-000000000004');
select pg_temp.as_admin();
set local role authenticated;
select is((public.admin_summary() ->> 'invoices_attention')::int, 1, 'summary: counts an invoice whose job stopped, as the list shows it');
reset role;

-- An order flagged for refund is never invoiced again.
select public.prepare_invoice('c9000000-0000-4000-8000-000000000002');
update public.invoices set status = 'rejected' where order_id = 'c9000000-0000-4000-8000-000000000002';
update public.orders set needs_refund = true, refund_reason = 'insufficient_stock_after_payment' where id = 'c9000000-0000-4000-8000-000000000002';
select pg_temp.as_admin();
set local role authenticated;
select is(public.retry_invoice((select id from public.invoices where order_id = 'c9000000-0000-4000-8000-000000000002'), 'Prueba') ->> 'error',
  'order_not_invoiceable', 'invoice: not for an order to refund');
reset role;

-- ---------------------------------------------------------------------------
-- Queue health
-- ---------------------------------------------------------------------------

update public.actions set created_at = now() - interval '20 minutes'
where idempotency_key = private.uuid_from_text('issue_invoice:c9000000-0000-4000-8000-000000000001');
insert into public.actions (idempotency_key, type, status, started_at, updated_at)
values (gen_random_uuid(), 'noop', 'processing', now() - interval '30 minutes', now() - interval '30 minutes');
-- set_updated_at would rewrite updated_at on update; the insert keeps it.
select pg_temp.as_admin();
set local role authenticated;
select is(
  (select (q ->> 'overdue') || ':' || (q ->> 'stalled') from (select public.admin_queue_status() q) x),
  '1:1', 'queue: an action due for 10+ minutes and one stalled in processing'
);
select ok((public.admin_summary() ->> 'queue_stuck')::int >= 2, 'summary: the stuck queue is counted');
reset role;

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

-- A late payment for a cancelled order (D-040).
insert into public.orders (id, customer_id, channel, status, fulfillment, sale_unit, subtotal_cop, total_cop, total_base_units,
                           idempotency_key, cancelled_at, cancel_reason, needs_refund, refund_reason)
values ('c9000000-0000-4000-8000-000000000003', 'c8000000-0000-4000-8000-000000000001', 'web', 'cancelled', 'pickup', 'unit',
        45000, 45000, 1, gen_random_uuid(), now(), 'payment_window_expired', true, 'payment_for_closed_order');

select pg_temp.as_admin();
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.admin_list_refunds())), 2, 'refunds: both orders are listed');
select is(public.mark_order_refunded('c9000000-0000-4000-8000-000000000001', 'WOMPI-1', 'Prueba') ->> 'error',
  'order_not_refundable', 'refunds: only orders flagged for refund');
select is(public.mark_order_refunded('c9000000-0000-4000-8000-000000000002', 'WOMPI-REF-123', 'Devuelto por el panel de Wompi') ->> 'ok',
  'true', 'refunds: recorded');
select is(public.mark_order_refunded('c9000000-0000-4000-8000-000000000002', 'WOMPI-REF-123', 'Doble clic') ->> 'already_refunded',
  'true', 'refunds: recording twice does nothing');
select is(public.mark_order_refunded('c9000000-0000-4000-8000-000000000003', 'WOMPI-REF-124', 'Pago tardío devuelto') ->> 'ok',
  'true', 'refunds: a cancelled order');
reset role;

select is(
  (select string_agg(status::text || ':' || refund_reference, ',' order by id) from public.orders
   where id in ('c9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000003')),
  'refunded:WOMPI-REF-123,cancelled:WOMPI-REF-124', 'refunds: paid becomes refunded, cancelled stays cancelled'
);
select is(
  (select count(*)::int from public.order_events
   where order_id in ('c9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000003')
     and (to_status = 'refunded' or reason like 'Reembolso registrado%')),
  2, 'refunds: one history event each, never duplicated'
);
select is(
  (select reason from public.order_events where order_id = 'c9000000-0000-4000-8000-000000000002' and to_status = 'refunded'),
  'Reembolso registrado (WOMPI-REF-123): Devuelto por el panel de Wompi', 'refunds: the history keeps the reference and the note'
);
select throws_ok(
  $$update public.orders set refund_reference = 'X-123' where id = 'c9000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'refunds: a reference without a recorded refund is rejected'
);

select * from finish();
rollback;
