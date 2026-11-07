-- Tests for server-side catalog and pricing (plan step 9, D-036).
-- Run with `npm run db:test`. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

update public.price_lists set is_default = false;

insert into public.price_lists (id, name, customer_type, is_default) values
  ('80000000-0000-4000-8000-000000000001', 'P retail default', 'retail', true),
  ('80000000-0000-4000-8000-000000000002', 'P wholesale default', 'wholesale', true),
  ('80000000-0000-4000-8000-000000000003', 'P wholesale special', 'wholesale', false),
  ('80000000-0000-4000-8000-000000000004', 'P retail special', 'retail', false);

-- N: national, sold by unit. NB: national, box only. I: imported.
-- NP: national without any price. NX: inactive.
insert into public.products
  (id, sku, name, origin, units_per_box, allow_retail_by_unit, retail_min_units, wholesale_min_boxes, is_active)
values
  ('80000000-0000-4000-8000-000000000101', 'TEST-N',  'N',  'national', 12, true,  2, 3, true),
  ('80000000-0000-4000-8000-000000000102', 'TEST-NB', 'NB', 'national', 24, false, 1, 1, true),
  ('80000000-0000-4000-8000-000000000103', 'TEST-I',  'I',  'imported',  6, false, 1, 1, true),
  ('80000000-0000-4000-8000-000000000104', 'TEST-NP', 'NP', 'national', 12, true,  1, 1, true),
  ('80000000-0000-4000-8000-000000000105', 'TEST-NX', 'NX', 'national', 12, true,  1, 1, false);

insert into public.product_prices (price_list_id, product_id, price_cop) values
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000101', 1000),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000102', 2000),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000105', 1000),
  ('80000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000101', 10000),
  ('80000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000102', 20000),
  ('80000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000103', 50000),
  ('80000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000103', 45000),
  ('80000000-0000-4000-8000-000000000004', '80000000-0000-4000-8000-000000000101', 900);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('81000000-0000-4000-8000-000000000001', 'r@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('81000000-0000-4000-8000-000000000002', 'rs@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('81000000-0000-4000-8000-000000000003', 'wp@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('81000000-0000-4000-8000-000000000004', 'wa@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('81000000-0000-4000-8000-000000000005', 'wa2@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');

insert into public.customers (id, customer_type, wholesale_status, full_name, price_list_id) values
  ('81000000-0000-4000-8000-000000000001', 'retail', null, 'Retail', null),
  ('81000000-0000-4000-8000-000000000002', 'retail', null, 'Retail special', '80000000-0000-4000-8000-000000000004'),
  ('81000000-0000-4000-8000-000000000003', 'wholesale', 'pending', 'Pending', '80000000-0000-4000-8000-000000000003'),
  ('81000000-0000-4000-8000-000000000004', 'wholesale', 'approved', 'Approved', '80000000-0000-4000-8000-000000000003'),
  ('81000000-0000-4000-8000-000000000005', 'wholesale', 'approved', 'Approved no special', null);

-- Catalog rows of the fixtures as "sku:sale_unit:price:min".
create view pg_temp.my_catalog as
  select sku || ':' || sale_unit || ':' || price_cop || ':' || min_quantity as row
  from public.get_catalog() where sku like 'TEST-%' order by sku;
grant select on pg_temp.my_catalog to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Visitor
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select results_eq(
  $$select row from pg_temp.my_catalog$$,
  array['TEST-N:unit:1000:2'],
  'visitor: only national products sold by unit, with a price and active'
);
select is(
  public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":2,"price_cop":1,"unit_price_cop":1}]') #>> '{lines,0,unit_price_cop}',
  '1000',
  'quote: a price sent by the browser is ignored'
);
select is(
  public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":1}]') #>> '{lines,0,error}',
  'below_minimum',
  'quote: below the retail minimum is rejected'
);
select is(
  public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000102","quantity":5}]') #>> '{lines,0,error}',
  'product_unavailable',
  'quote: a box-only product cannot be bought by unit'
);
select is(
  public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000103","quantity":5}]') #>> '{lines,0,error}',
  'product_unavailable',
  'quote: an imported product cannot be bought by a visitor'
);
select results_eq(
  $$select public.quote_items(x) #>> '{lines,0,error}' from (values
      ('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":2.5}]'::jsonb),
      ('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":-3}]'::jsonb),
      ('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":"3"}]'::jsonb),
      ('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":0}]'::jsonb)
    ) as t(x)$$,
  array['invalid_quantity', 'invalid_quantity', 'invalid_quantity', 'invalid_quantity'],
  'quote: decimals, negatives, text and zero are invalid quantities'
);
select is(
  public.quote_items('[{"product_id":"not-a-uuid","quantity":2}]') #>> '{lines,0,error}',
  'invalid_product',
  'quote: an invalid product id is rejected'
);
select is(
  public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":2},{"product_id":"80000000-0000-4000-8000-000000000101","quantity":3}]') #>> '{lines,1,error}',
  'duplicate_product',
  'quote: the same product twice is rejected'
);
select throws_ok(
  $$select public.quote_items('{"product_id":"x"}')$$,
  '22023',
  'quote_invalid_items',
  'quote: the input must be a non-empty list'
);
select is(
  (public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":2},{"product_id":"80000000-0000-4000-8000-000000000103","quantity":1}]') ->> 'total_cop'),
  null,
  'quote: no total is given when any line has an error'
);

reset role;

-- ---------------------------------------------------------------------------
-- Retail customers
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
set local role authenticated;

select results_eq(
  $$select row from pg_temp.my_catalog$$,
  array['TEST-N:unit:1000:2'],
  'retail: same catalog and price as a visitor'
);
select is(
  public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":4}]'),
  '{"ok": true, "lines": [{"error": null, "index": 1, "quantity": 4, "base_units": 4, "product_id": "80000000-0000-4000-8000-000000000101", "min_quantity": 2, "line_total_cop": 4000, "unit_price_cop": 1000}], "sale_unit": "unit", "total_cop": 4000, "total_boxes": 0, "total_base_units": 4}'::jsonb,
  'retail: a valid quote has the total in pesos and units'
);

reset role;

select set_config('request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
set local role authenticated;

select results_eq(
  $$select row from pg_temp.my_catalog$$,
  array['TEST-N:unit:900:2'],
  'retail with a special list: pays the special price'
);

reset role;

-- ---------------------------------------------------------------------------
-- Wholesale pending approval: buys as retail
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"customer_type":"wholesale","wholesale_approved":false}}', true);
set local role authenticated;

select results_eq(
  $$select row from pg_temp.my_catalog$$,
  array['TEST-N:unit:1000:2'],
  'pending wholesale: retail catalog and prices, special wholesale list ignored'
);
select is(
  public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":2}]') ->> 'sale_unit',
  'unit',
  'pending wholesale: can buy by unit (P-011)'
);

reset role;

-- ---------------------------------------------------------------------------
-- Approved wholesale
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"customer_type":"wholesale","wholesale_approved":true}}', true);
set local role authenticated;

select results_eq(
  $$select row from pg_temp.my_catalog$$,
  array['TEST-I:box:45000:1', 'TEST-N:box:10000:3', 'TEST-NB:box:20000:1'],
  'approved wholesale: boxes, imported included, special price with fallback to the general list'
);
select is(
  public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":2}]') #>> '{lines,0,error}',
  'below_minimum',
  'approved wholesale: below the minimum number of boxes is rejected'
);

create temporary table t_quote as
  select public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000101","quantity":3},{"product_id":"80000000-0000-4000-8000-000000000103","quantity":2}]') as q;

select is((select q ->> 'ok' from t_quote), 'true', 'approved wholesale: the quote is valid');
select is((select (q ->> 'total_cop')::bigint from t_quote), 120000::bigint, 'approved wholesale: total = 3 x 10.000 + 2 x 45.000');
select is((select (q ->> 'total_boxes')::int from t_quote), 5, 'approved wholesale: total boxes, for the free delivery rule');
select is((select (q ->> 'total_base_units')::int from t_quote), 48, 'approved wholesale: units for stock = 3 x 12 + 2 x 6');

reset role;

select set_config('request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000005","role":"authenticated","app_metadata":{"customer_type":"wholesale","wholesale_approved":true}}', true);
set local role authenticated;

select results_eq(
  $$select row from pg_temp.my_catalog where row like 'TEST-I:%'$$,
  array['TEST-I:box:50000:1'],
  'approved wholesale without a special list: general wholesale price'
);

reset role;

-- user_metadata never changes the price.
select set_config('request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"},"user_metadata":{"customer_type":"wholesale","wholesale_approved":true}}', true);
set local role authenticated;

select results_eq(
  $$select row from pg_temp.my_catalog$$,
  array['TEST-N:unit:1000:2'],
  'security: user_metadata cannot unlock wholesale prices'
);
select is(
  public.quote_items('[{"product_id":"80000000-0000-4000-8000-000000000103","quantity":1}]') #>> '{lines,0,error}',
  'product_unavailable',
  'security: a retail customer cannot quote an imported product'
);

reset role;

select * from finish();
rollback;
