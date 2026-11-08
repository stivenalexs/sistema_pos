-- Tests for POS sales (plan step 16, D-053). Uses seed.sql products and stock:
-- 101 aguardiente (120 units, retail 45.000, wholesale 480.000 per box of 12),
-- 102 ron (60 units, retail 52.000), 201 whisky (imported). Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('a5000000-0000-4000-8000-000000000001', 'posr@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('a5000000-0000-4000-8000-000000000002', 'posw@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('a5000000-0000-4000-8000-000000000011', 'cajero@test.local', 'authenticated', 'authenticated', '{"staff_role":"cashier"}'),
  ('a5000000-0000-4000-8000-000000000012', 'bodega@test.local', 'authenticated', 'authenticated', '{"staff_role":"warehouse"}'),
  ('a5000000-0000-4000-8000-000000000021', 'admin@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}');
insert into public.customers (id, customer_type, wholesale_status, full_name, business_name, document_type, document_number) values
  ('a5000000-0000-4000-8000-000000000001', 'retail', null, 'Cliente POS', null, null, null),
  ('a5000000-0000-4000-8000-000000000002', 'wholesale', 'approved', 'Mayorista POS', 'Licores W SAS', 'nit', '9001234567'),
  -- The cashier's own account is also an approved wholesale customer: a sale
  -- without a buyer must still be priced as an anonymous retail buyer.
  ('a5000000-0000-4000-8000-000000000011', 'wholesale', 'approved', 'Cajero también mayorista', 'Cajero SAS', 'nit', '9005550001');

create function pg_temp.as_user(p_id text, p_meta text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":' || p_meta || '}', true);
$$;
create function pg_temp.as_cashier() returns void language sql as $$
  select pg_temp.as_user('a5000000-0000-4000-8000-000000000011', '{"staff_role":"cashier"}');
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.as_user('a5000000-0000-4000-8000-000000000021', '{"staff_role":"admin"}');
$$;
create function pg_temp.on_hand(p uuid) returns integer language sql as $$
  select on_hand from public.product_stock where product_id = p;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

create function pg_temp.sale(p_key text, p_items text, p_method text, p_cash bigint, p_customer text, p_age boolean)
returns jsonb language sql as $$
  select public.create_pos_sale(p_key::uuid, p_items::jsonb, p_method, p_cash, p_customer::uuid, p_age);
$$;
grant execute on function pg_temp.sale(text, text, text, bigint, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Who can sell
-- ---------------------------------------------------------------------------

select pg_temp.as_user('a5000000-0000-4000-8000-000000000001', '{"customer_type":"retail"}');
set local role authenticated;
select throws_ok(
  $$select pg_temp.sale(gen_random_uuid()::text, '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":1}]', 'cash', 50000, null, true)$$,
  '42501', 'pos_forbidden', 'role: a customer cannot sell'
);
reset role;

select pg_temp.as_user('a5000000-0000-4000-8000-000000000012', '{"staff_role":"warehouse"}');
set local role authenticated;
select throws_ok($$select public.get_pos_catalog()$$, '42501', 'pos_forbidden', 'role: warehouse cannot use the POS');
reset role;

-- ---------------------------------------------------------------------------
-- Catalog and customers
-- ---------------------------------------------------------------------------

select pg_temp.as_cashier();
set local role authenticated;
select is(
  (select (i ->> 'price_cop') || ':' || (i ->> 'available_units') || ':' || (i ->> 'sale_unit')
   from jsonb_array_elements(public.get_pos_catalog() -> 'items') i where i ->> 'sku' = 'NAC-AGU-750'),
  '45000:120:unit', 'catalog: retail price and real availability, never the cashier''s own wholesale account'
);
select ok(
  not exists (select 1 from jsonb_array_elements(public.get_pos_catalog() -> 'items') i where i ->> 'sku' = 'IMP-WHI-700'),
  'catalog: imported products are not sold at retail'
);
select is(public.find_pos_customer('900.123.456-7') ->> 'full_name', 'Licores W SAS', 'customer: found by NIT, with dots');
select is(public.find_pos_customer('POSR@test.local') ->> 'customer_type', 'retail', 'customer: found by email');
select is(public.find_pos_customer('12345'), null, 'customer: unknown document gives nothing');
select is(
  (select (i ->> 'price_cop') || ':' || (i ->> 'sale_unit') || ':' || (i ->> 'available_sale_units')
   from jsonb_array_elements(public.get_pos_catalog('a5000000-0000-4000-8000-000000000002') -> 'items') i
   where i ->> 'sku' = 'NAC-AGU-750'),
  '480000:box:10', 'catalog: an approved wholesale customer buys by box at their price'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.get_pos_catalog() -> 'items') i where i ->> 'sale_unit' = 'box'),
  0, 'catalog: impersonation ends with the call (the cashier sees retail again)'
);

-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------

select is(
  pg_temp.sale('b5000000-0000-4000-8000-000000000001', '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":1}]', 'cash', 50000, null, false) ->> 'error',
  'age_not_confirmed', 'sale: legal age must be confirmed'
);
select is(
  pg_temp.sale('b5000000-0000-4000-8000-000000000001', '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":1}]', 'bitcoin', 50000, null, true) ->> 'error',
  'invalid_payment_method', 'sale: unknown payment method'
);
select is(
  pg_temp.sale('b5000000-0000-4000-8000-000000000001', '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":2}]', 'cash', 80000, null, true) ->> 'error',
  'cash_insufficient', 'sale: cash below the total'
);
select is((select count(*)::int from public.orders where channel = 'pos'), 0, 'sale: nothing was created');

-- ---------------------------------------------------------------------------
-- Cash sale
-- ---------------------------------------------------------------------------

create temporary table t_sale as
  select pg_temp.sale('b5000000-0000-4000-8000-000000000002',
    '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":2,"unit_price_cop":1}]',
    'cash', 100000, null, true) as r;
reset role;
grant select on t_sale to authenticated;

select is(
  (select status::text || ':' || total_cop || ':' || cash_received_cop || ':' || change_cop || ':' || age_confirmed
   from public.orders where id = (select (r ->> 'order_id')::uuid from t_sale)),
  'delivered:90000:100000:10000:true', 'sale: delivered at once, server price (browser price ignored), change'
);
select is(pg_temp.on_hand('00000000-0000-4000-8000-000000000101'), 118, 'sale: stock went down by 2');
select is(
  (select count(*)::int from public.actions
   where type = 'issue_invoice' and payload ->> 'order_id' = (select r ->> 'order_id' from t_sale)),
  1, 'sale: the invoice is enqueued'
);

select pg_temp.as_cashier();
set local role authenticated;
select is(
  pg_temp.sale('b5000000-0000-4000-8000-000000000002', '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":2}]', 'cash', 100000, null, true) ->> 'order_id',
  (select r ->> 'order_id' from t_sale), 'sale: the same key returns the same sale'
);
reset role;
select is(pg_temp.on_hand('00000000-0000-4000-8000-000000000101'), 118, 'sale: a retry does not sell twice');

select is(
  (select payment_method_code || ':' || (customer ->> 'kind') from jsonb_to_record(public.prepare_invoice((select (r ->> 'order_id')::uuid from t_sale)))
     as x(payment_method_code text, customer jsonb)),
  'POS_CASH:final_consumer', 'invoice: POS payment method and consumidor final'
);

-- ---------------------------------------------------------------------------
-- Wholesale customer, reservations and exact stock
-- ---------------------------------------------------------------------------

select pg_temp.as_cashier();
set local role authenticated;
create temporary table t_wholesale as
  select pg_temp.sale('b5000000-0000-4000-8000-000000000003',
    '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":1}]',
    'card', null, 'a5000000-0000-4000-8000-000000000002', true) as r;
reset role;
select is(
  (select sale_unit || ':' || total_cop || ':' || total_base_units || ':' || (customer_id is not null)
   from public.orders where id = (select (r ->> 'order_id')::uuid from t_wholesale)),
  'box:480000:12:true', 'wholesale: one box at the wholesale price, linked to the customer'
);
select is(
  (select customer ->> 'kind' from public.invoices i
   where i.order_id = (select (r ->> 'order_id')::uuid from t_wholesale) union all
   select (public.prepare_invoice((select (r ->> 'order_id')::uuid from t_wholesale)) -> 'customer') ->> 'kind' limit 1),
  'company', 'wholesale: the invoice goes to the company with its NIT'
);

-- A pending web order holds 58 of the 60 bottles of ron.
select private.reserve_units('web-order-test', '[{"product_id":"00000000-0000-4000-8000-000000000102","units":58}]', 30, null);

select pg_temp.as_cashier();
set local role authenticated;
select is(
  (select (r ->> 'error') || ':' || (r ->> 'available_units')
   from (select pg_temp.sale('b5000000-0000-4000-8000-000000000004',
     '[{"product_id":"00000000-0000-4000-8000-000000000102","quantity":3}]', 'card', null, null, true) r) s),
  'insufficient_stock:2', 'stock: the POS never sells units reserved by the web'
);
select is(
  pg_temp.sale('b5000000-0000-4000-8000-000000000005',
    '[{"product_id":"00000000-0000-4000-8000-000000000102","quantity":2}]', 'transfer', null, null, true) ->> 'ok',
  'true', 'stock: exactly the available units can be sold'
);
select is(
  pg_temp.sale('b5000000-0000-4000-8000-000000000006',
    '[{"product_id":"00000000-0000-4000-8000-000000000102","quantity":1}]', 'card', null, null, true) ->> 'error',
  'insufficient_stock', 'stock: nothing left after that'
);
reset role;

-- ---------------------------------------------------------------------------
-- Sales block on the POS channel (step 15)
-- ---------------------------------------------------------------------------

insert into public.sales_blocks (name, kind, channels, starts_at, ends_at, message)
values ('Ley seca POS', 'date_range', array['pos'], now() - interval '1 hour', now() + interval '1 hour', 'Ley seca: la caja no vende.');
select pg_temp.as_cashier();
set local role authenticated;
select is(
  pg_temp.sale('b5000000-0000-4000-8000-000000000007',
    '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":1}]', 'card', null, null, true) #>> '{block,message}',
  'Ley seca: la caja no vende.', 'block: the POS does not sell during a rule'
);
reset role;
delete from public.sales_blocks where name = 'Ley seca POS';

-- ---------------------------------------------------------------------------
-- Void (administrator only)
-- ---------------------------------------------------------------------------

select pg_temp.as_cashier();
set local role authenticated;
select throws_ok(
  format($$select public.void_pos_sale(%L, 'Error de digitación')$$, (select r ->> 'order_id' from t_sale)),
  '42501', 'pos_void_forbidden', 'void: a cashier cannot void'
);
reset role;

-- t_sale has a prepared invoice that is not accepted yet.
select pg_temp.as_admin();
set local role authenticated;
select is(
  public.void_pos_sale((select (r ->> 'order_id')::uuid from t_sale), 'Error de digitación') ->> 'error',
  'invoice_in_progress', 'void: waits while the invoice is being issued'
);
reset role;

-- Accepted by the DIAN: void gives the stock back and asks for the credit note.
select public.record_invoice_result(
  (select id from public.invoices where order_id = (select (r ->> 'order_id')::uuid from t_sale)),
  'accepted', '{}'::jsonb, '{"data":{"number":"SETP990000001","cufe":"cufe-pos-1"}}'::jsonb
);
select pg_temp.as_admin();
set local role authenticated;
select isnt(
  public.void_pos_sale((select (r ->> 'order_id')::uuid from t_sale), 'Error de digitación') ->> 'credit_note_id',
  null, 'void: requests the credit note of the accepted invoice'
);
select is(
  public.void_pos_sale((select (r ->> 'order_id')::uuid from t_sale), 'Error de digitación') ->> 'already_voided',
  'true', 'void: a second void does nothing'
);
reset role;
select is(
  (select status::text || ':' || pg_temp.on_hand('00000000-0000-4000-8000-000000000101')
   from public.orders where id = (select (r ->> 'order_id')::uuid from t_sale)),
  'refunded:108', 'void: refunded and the 2 bottles are back (120 - 2 - 12 + 2)'
);
select is((select count(*)::int from public.credit_notes), 1, 'void: exactly one credit note');

-- ---------------------------------------------------------------------------
-- Hardening after the external review
-- ---------------------------------------------------------------------------

select pg_temp.as_user('a5000000-0000-4000-8000-000000000001', '{"customer_type":"retail"}');
set local role authenticated;
select throws_ok(
  $$select private.pos_available_units('00000000-0000-4000-8000-000000000101')$$,
  '42501', 'pos_forbidden', 'stock: a customer cannot read the POS availability'
);
reset role;

select pg_temp.as_cashier();
set local role authenticated;
select throws_ok(
  $$select private.create_pos_order(gen_random_uuid(),
    '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":1}]', 'card', null, null, false)$$,
  '22023', 'pos_age_not_confirmed', 'direct call: the private function checks the age itself'
);
create temporary table t_direct as
  select private.create_pos_order('b5000000-0000-4000-8000-000000000010',
    '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":1,"unit_price_cop":1}]', 'card', null, null, true) as r;
reset role;
select is(
  (select total_cop from public.orders where id = (select (r ->> 'order_id')::uuid from t_direct)),
  45000::bigint, 'direct call: the private function prices the items itself'
);

-- Void before the invoice exists: the queued invoice can no longer be issued.
select pg_temp.as_admin();
set local role authenticated;
select is(
  public.void_pos_sale((select (r ->> 'order_id')::uuid from t_direct), 'Venta de prueba') ->> 'ok',
  'true', 'void: before the worker prepares the invoice'
);
reset role;
select throws_ok(
  format($$select public.prepare_invoice(%L)$$, (select r ->> 'order_id' from t_direct)),
  '22023', 'invoice_order_not_invoiceable', 'void: the queued invoice fails for good afterwards'
);

-- A rejected invoice does not block the void, and can never be sent later.
select public.record_invoice_result(
  (select id from public.invoices where order_id = (select (r ->> 'order_id')::uuid from t_wholesale)),
  'rejected', '{}'::jsonb, '{"message":"rango de numeración vencido"}'::jsonb, '422: rango'
);
select pg_temp.as_admin();
set local role authenticated;
select is(
  (select (v ->> 'ok') || ':' || coalesce(v ->> 'credit_note_id', 'none')
   from (select public.void_pos_sale((select (r ->> 'order_id')::uuid from t_wholesale), 'Factura rechazada') v) x),
  'true:none', 'void: goes ahead with a rejected invoice, no credit note'
);
reset role;
select throws_ok(
  format($$select public.prepare_invoice(%L)$$, (select r ->> 'order_id' from t_wholesale)),
  '22023', 'invoice_order_not_invoiceable', 'void: the rejected invoice of a voided sale cannot be resent'
);
select is(
  (select reason from public.order_events
   where order_id = (select (r ->> 'order_id')::uuid from t_wholesale) and to_status = 'refunded'),
  'Factura rechazada', 'history: the refund event keeps the void reason'
);

-- A customer only sees their own purchases.
select pg_temp.as_user('a5000000-0000-4000-8000-000000000001', '{"customer_type":"retail"}');
set local role authenticated;
select is_empty($$select * from public.orders where channel = 'pos'$$, 'rls: a customer does not see other POS sales');
reset role;

select * from finish();
rollback;
