-- RLS tests for catalog, customers and price lists (plan step 6, D-031).
-- Run with `npm run db:test`. Everything runs in a transaction and is rolled
-- back, so the local data is left untouched.

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres, RLS does not apply)
-- ---------------------------------------------------------------------------

-- Free the "default" slots taken by seed.sql inside this transaction.
update public.price_lists set is_default = false;

insert into public.price_lists (id, name, customer_type, is_default) values
  ('10000000-0000-4000-8000-000000000001', 'T retail default', 'retail', true),
  ('10000000-0000-4000-8000-000000000002', 'T wholesale default', 'wholesale', true),
  ('10000000-0000-4000-8000-000000000003', 'T wholesale special', 'wholesale', false);

insert into public.products (id, sku, name, origin, units_per_box, allow_retail_by_unit, is_active) values
  ('10000000-0000-4000-8000-000000000101', 'TEST-N', 'Test national', 'national', 12, true, true),
  ('10000000-0000-4000-8000-000000000102', 'TEST-I', 'Test imported', 'imported', 6, false, true),
  ('10000000-0000-4000-8000-000000000103', 'TEST-X', 'Test inactive', 'national', 12, true, false);

insert into public.product_prices (price_list_id, product_id, price_cop) values
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000101', 45000),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000101', 480000),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000102', 1150000),
  ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000102', 1100000);

insert into auth.users (id, email, aud, role) values
  ('20000000-0000-4000-8000-000000000001', 'retail@test.local', 'authenticated', 'authenticated'),
  ('20000000-0000-4000-8000-000000000002', 'pending@test.local', 'authenticated', 'authenticated'),
  ('20000000-0000-4000-8000-000000000003', 'wholesale@test.local', 'authenticated', 'authenticated'),
  ('20000000-0000-4000-8000-000000000004', 'wholesale2@test.local', 'authenticated', 'authenticated');

insert into public.customers (id, customer_type, wholesale_status, full_name, price_list_id) values
  ('20000000-0000-4000-8000-000000000001', 'retail', null, 'Cliente minorista', null),
  ('20000000-0000-4000-8000-000000000002', 'wholesale', 'pending', 'Mayorista pendiente', '10000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000003', 'wholesale', 'approved', 'Mayorista aprobado', '10000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000004', 'wholesale', 'approved', 'Mayorista sin lista especial', null);

-- ---------------------------------------------------------------------------
-- Visitor without an account (anon)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select results_eq(
  $$select sku from public.products where sku like 'TEST-%' order by sku$$,
  array['TEST-N'],
  'anon: sees only active national products'
);
select results_eq(
  $$select name from public.price_lists where name like 'T %' order by name$$,
  array['T retail default'],
  'anon: sees only the default retail list'
);
select results_eq(
  $$select pl.name || ':' || p.sku from public.product_prices pp
    join public.price_lists pl on pl.id = pp.price_list_id
    join public.products p on p.id = pp.product_id
    where p.sku like 'TEST-%' order by 1$$,
  array['T retail default:TEST-N'],
  'anon: sees only retail prices of national products'
);
select throws_ok(
  $$select * from public.customers$$,
  '42501',
  null,
  'anon: cannot read customers at all'
);

reset role;

-- ---------------------------------------------------------------------------
-- Retail customer
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"}}',
  true);
set local role authenticated;

select results_eq(
  $$select sku from public.products where sku like 'TEST-%' order by sku$$,
  array['TEST-N'],
  'retail: does not see imported or inactive products'
);
select results_eq(
  $$select name from public.price_lists where name like 'T %' order by name$$,
  array['T retail default'],
  'retail: does not see wholesale lists'
);
select results_eq(
  $$select full_name from public.customers order by full_name$$,
  array['Cliente minorista'],
  'retail: reads only its own customer row'
);
select lives_ok(
  $$update public.customers set phone = '3000000000'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'retail: can update its own phone'
);
select throws_ok(
  $$update public.customers set customer_type = 'wholesale'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'retail: cannot change its own customer type'
);
select throws_ok(
  $$update public.customers set price_list_id = '10000000-0000-4000-8000-000000000003'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'retail: cannot assign itself a price list'
);
select results_eq(
  $$with u as (
      update public.customers set phone = '3111111111'
      where id = '20000000-0000-4000-8000-000000000003'
      returning 1
    ) select count(*)::int from u$$,
  array[0],
  'retail: cannot update another customer'
);
select throws_ok(
  $$insert into public.products (sku, name, origin, units_per_box)
    values ('TEST-HACK', 'Hack', 'national', 1)$$,
  '42501',
  null,
  'retail: cannot create products'
);
select results_eq(
  $$with u as (
      update public.product_prices set price_cop = 1
      where product_id = '10000000-0000-4000-8000-000000000101'
      returning 1
    ) select count(*)::int from u$$,
  array[0],
  'retail: cannot change prices'
);

reset role;

-- user_metadata is editable by the user, so it must never grant access.
select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"customer_type":"retail"},"user_metadata":{"customer_type":"wholesale","wholesale_approved":true,"staff_role":"admin"}}',
  true);
set local role authenticated;

select results_eq(
  $$select sku from public.products where sku like 'TEST-%' order by sku$$,
  array['TEST-N'],
  'retail: user_metadata claims are ignored'
);

reset role;

-- ---------------------------------------------------------------------------
-- Wholesale customer pending approval: treated as retail
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"customer_type":"wholesale","wholesale_approved":false}}',
  true);
set local role authenticated;

select results_eq(
  $$select sku from public.products where sku like 'TEST-%' order by sku$$,
  array['TEST-N'],
  'pending wholesale: does not see imported products'
);
select results_eq(
  $$select name from public.price_lists where name like 'T %' order by name$$,
  array['T retail default'],
  'pending wholesale: does not see wholesale lists, not even its assigned one'
);
select results_eq(
  $$select pl.name || ':' || p.sku from public.product_prices pp
    join public.price_lists pl on pl.id = pp.price_list_id
    join public.products p on p.id = pp.product_id
    where p.sku like 'TEST-%' order by 1$$,
  array['T retail default:TEST-N'],
  'pending wholesale: sees only retail prices'
);

reset role;

-- ---------------------------------------------------------------------------
-- Approved wholesale customers
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"customer_type":"wholesale","wholesale_approved":true}}',
  true);
set local role authenticated;

select results_eq(
  $$select sku from public.products where sku like 'TEST-%' order by sku$$,
  array['TEST-I', 'TEST-N'],
  'approved wholesale: sees active national and imported products'
);
select results_eq(
  $$select name from public.price_lists where name like 'T %' order by name$$,
  array['T retail default', 'T wholesale default', 'T wholesale special'],
  'approved wholesale: sees its assigned special list'
);
select results_eq(
  $$select pl.name || ':' || p.sku from public.product_prices pp
    join public.price_lists pl on pl.id = pp.price_list_id
    join public.products p on p.id = pp.product_id
    where p.sku like 'TEST-%' order by 1$$,
  array[
    'T retail default:TEST-N',
    'T wholesale default:TEST-I',
    'T wholesale default:TEST-N',
    'T wholesale special:TEST-I'
  ],
  'approved wholesale: sees wholesale prices, including imported products'
);

reset role;

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"customer_type":"wholesale","wholesale_approved":true}}',
  true);
set local role authenticated;

select results_eq(
  $$select name from public.price_lists where name like 'T %' order by name$$,
  array['T retail default', 'T wholesale default'],
  'approved wholesale: does not see special lists assigned to others'
);

reset role;

-- ---------------------------------------------------------------------------
-- Staff roles
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"staff_role":"cashier"}}',
  true);
set local role authenticated;

select results_eq(
  $$select sku from public.products where sku like 'TEST-%' order by sku$$,
  array['TEST-I', 'TEST-N'],
  'cashier: sees every active product'
);
select is_empty(
  $$select * from public.customers$$,
  'cashier: cannot read customers'
);
select results_eq(
  $$with u as (
      update public.product_prices set price_cop = 1
      where product_id = '10000000-0000-4000-8000-000000000101'
      returning 1
    ) select count(*)::int from u$$,
  array[0],
  'cashier: cannot change prices'
);

reset role;

select set_config('request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"staff_role":"warehouse"}}',
  true);
set local role authenticated;

select results_eq(
  $$select sku from public.products where sku like 'TEST-%' order by sku$$,
  array['TEST-I', 'TEST-N', 'TEST-X'],
  'warehouse: sees every product, including inactive ones'
);

reset role;

select set_config('request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"staff_role":"courier"}}',
  true);
set local role authenticated;

select results_eq(
  $$select sku from public.products where sku like 'TEST-%' order by sku$$,
  array['TEST-N'],
  'courier: sees only active national products'
);

reset role;

select set_config('request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"staff_role":"admin"}}',
  true);
set local role authenticated;

select results_eq(
  $$select sku from public.products where sku like 'TEST-%' order by sku$$,
  array['TEST-I', 'TEST-N', 'TEST-X'],
  'admin: sees every product'
);
select lives_ok(
  $$insert into public.products (sku, name, origin, units_per_box)
    values ('TEST-NEW', 'New product', 'national', 12)$$,
  'admin: can create products'
);
select results_eq(
  $$with u as (
      update public.product_prices set price_cop = 46000
      where price_list_id = '10000000-0000-4000-8000-000000000001'
        and product_id = '10000000-0000-4000-8000-000000000101'
      returning 1
    ) select count(*)::int from u$$,
  array[1],
  'admin: can change prices'
);
select results_eq(
  $$select count(*)::int from public.customers
    where id::text like '20000000-%'$$,
  array[4],
  'admin: reads every customer'
);

reset role;

select * from finish();
rollback;
