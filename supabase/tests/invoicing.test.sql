-- Tests for taxes and invoices (plan step 13, D-042, D-044). Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Products shaped like the examples of the tax guide (750 cc).
insert into public.products (id, sku, name, origin, units_per_box, allow_retail_by_unit, volume_ml, alcohol_degree, tax_category, is_fla) values
  ('b1000000-0000-4000-8000-000000000001', 'TX-AGU', 'Aguardiente FLA', 'national', 12, true, 750, 29, 'spirits', true),
  ('b1000000-0000-4000-8000-000000000002', 'TX-WHI', 'Whisky importado', 'imported', 6, false, 750, 40, 'spirits', false),
  ('b1000000-0000-4000-8000-000000000003', 'TX-VIN', 'Vino', 'imported', 12, false, 750, 13, 'wine', false),
  ('b1000000-0000-4000-8000-000000000004', 'TX-NODATA', 'Sin datos', 'national', 12, true, null, null, null, false);

-- ---------------------------------------------------------------------------
-- Tax breakdown (backwards from the final price)
-- ---------------------------------------------------------------------------

select is(
  (select row(base_cop, specific_cop, ad_valorem_cop, exploitation_cop, iva_cop)::text
   from private.tax_breakdown('b1000000-0000-4000-8000-000000000001', 1, 47712)),
  '(28000,10440,7000,0,2272)', 'tax: FLA aguardiente reproduces the guide (no exploitation right)'
);
select is(
  (select row(base_cop, specific_cop, ad_valorem_cop, exploitation_cop, iva_cop)::text
   from private.tax_breakdown('b1000000-0000-4000-8000-000000000002', 1, 108465)),
  '(70000,14400,17500,1400,5165)', 'tax: imported whisky with the 2 % exploitation right'
);
select is(
  (select row(base_cop, specific_cop, ad_valorem_cop, exploitation_cop, iva_cop)::text
   from private.tax_breakdown('b1000000-0000-4000-8000-000000000003', 1, 41117)),
  '(30000,3159,6000,0,1958)', 'tax: wine uses $243 and 20 %, no exploitation right'
);
select is(
  (select base_cop + specific_cop + ad_valorem_cop + exploitation_cop + iva_cop
   from private.tax_breakdown('b1000000-0000-4000-8000-000000000001', 3, 135001)),
  135001::bigint, 'tax: rounding is absorbed by the base, the line adds up exactly'
);
select is(
  (select specific_cop from private.tax_breakdown('b1000000-0000-4000-8000-000000000001', 3, 143136)),
  31320::bigint, 'tax: the specific component scales with the units (3 x 10.440)'
);
select is(
  (select row(specific_cop, ad_valorem_cop, iva_cop)::text
   from private.tax_breakdown('b1000000-0000-4000-8000-000000000004', 1, 10500)),
  '(0,0,500)', 'tax: a product without tax data is IVA only (assumption)'
);

-- ---------------------------------------------------------------------------
-- Invoice preparation and the paid-order trigger
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('b2000000-0000-4000-8000-000000000001', 'inv-r@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('b2000000-0000-4000-8000-000000000002', 'inv-w@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');
insert into public.customers (id, customer_type, wholesale_status, full_name, business_name, document_type, document_number) values
  ('b2000000-0000-4000-8000-000000000001', 'retail', null, 'R', null, null, null),
  ('b2000000-0000-4000-8000-000000000002', 'wholesale', 'approved', 'W', 'Licores W SAS', 'nit', '9001234567');

-- Paid orders built directly (the payment flow is covered by payments.test.sql).
insert into public.orders (id, customer_id, channel, status, fulfillment, sale_unit, subtotal_cop, total_cop, total_base_units, idempotency_key) values
  ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'web', 'awaiting_payment', 'pickup', 'unit', 47712, 47712, 1, gen_random_uuid()),
  ('b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'web', 'awaiting_payment', 'pickup', 'box', 650790, 650790, 6, gen_random_uuid());
insert into public.order_items (order_id, product_id, sku, product_name, sale_unit, units_per_box, quantity, unit_price_cop, line_total_cop, base_units) values
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'TX-AGU', 'Aguardiente FLA', 'unit', 12, 1, 47712, 47712, 1),
  ('b3000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'TX-WHI', 'Whisky importado', 'box', 6, 1, 650790, 650790, 6);

update public.orders set status = 'paid', paid_at = now() where id = 'b3000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.actions
   where type = 'issue_invoice' and payload ->> 'order_id' = 'b3000000-0000-4000-8000-000000000001'),
  1, 'trigger: a paid order enqueues its invoice'
);
update public.orders set status = 'preparing' where id = 'b3000000-0000-4000-8000-000000000001';
update public.orders set status = 'paid' where id = 'b3000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.actions
   where type = 'issue_invoice' and payload ->> 'order_id' = 'b3000000-0000-4000-8000-000000000001'),
  1, 'trigger: becoming paid again does not enqueue a second invoice'
);

update public.orders set status = 'paid', paid_at = now(), needs_refund = true, refund_reason = 'insufficient_stock_after_payment'
where id = 'b3000000-0000-4000-8000-000000000002';
select is(
  (select count(*)::int from public.actions
   where type = 'issue_invoice' and payload ->> 'order_id' = 'b3000000-0000-4000-8000-000000000002'),
  0, 'trigger: an order flagged for refund is not invoiced (D-044)'
);
select throws_ok(
  $$select public.prepare_invoice('b3000000-0000-4000-8000-000000000002')$$,
  '22023', 'invoice_order_not_invoiceable', 'prepare: refuses an order flagged for refund'
);

create temporary table t_inv as select public.prepare_invoice('b3000000-0000-4000-8000-000000000001') as j;
grant select on t_inv to authenticated, service_role;
select is(
  (select j ->> 'total_cop' || ':' || (j ->> 'iva_cop') || ':' || (j ->> 'participation_cop') from t_inv),
  '47712:2272:17440', 'prepare: totals carry the tax breakdown'
);
select is(
  (select j #>> '{customer,kind}' from t_inv), 'final_consumer',
  'prepare: a retail customer is invoiced as final consumer (assumption)'
);
select is(
  public.prepare_invoice('b3000000-0000-4000-8000-000000000001') ->> 'id',
  (select j ->> 'id' from t_inv),
  'prepare: idempotent, the same invoice is returned'
);

select public.record_invoice_result((select (j ->> 'id')::uuid from t_inv), 'accepted', '{}'::jsonb,
  '{"data":{"number":"SETP1","cufe":"abc","links":{"qr":"q","public_url":"u"},"errors":{}}}'::jsonb);
select public.record_invoice_result((select (j ->> 'id')::uuid from t_inv), 'rejected', '{}'::jsonb, '{}'::jsonb, 'late');
select is(
  (select status::text || ':' || factus_number || ':' || cufe from public.invoices where id = (select (j ->> 'id')::uuid from t_inv)),
  'accepted:SETP1:abc', 'result: an accepted invoice never changes afterwards'
);

-- ---------------------------------------------------------------------------
-- Credit notes
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"b2000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
set local role authenticated;
select throws_ok(
  $$select public.request_credit_note((select (j ->> 'id')::uuid from t_inv), 'Devolución')$$,
  '42501', 'credit_note_forbidden', 'credit note: a customer cannot request it'
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.request_credit_note((select (j ->> 'id')::uuid from t_inv), 'Devolución del pedido'),
  public.request_credit_note((select (j ->> 'id')::uuid from t_inv), 'Otra vez'),
  'credit note: one per invoice, requesting twice returns the same one'
);

select * from finish();
rollback;
