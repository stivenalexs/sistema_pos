-- Tests for the admin panel, part C: inventory (plan step 17c, D-056).
-- Run with `npm run db:test`. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into public.products (id, sku, name, origin, units_per_box, allow_retail_by_unit) values
  ('9a000000-0000-4000-8000-000000000001', 'INV17C-A', 'Producto A 17c', 'national', 6, true),
  ('9a000000-0000-4000-8000-000000000002', 'INV17C-B', 'Producto B 17c', 'national', 6, true);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('9b000000-0000-4000-8000-000000000001', 'bodega17c@test.local', 'authenticated', 'authenticated', '{"staff_role":"warehouse"}'),
  ('9b000000-0000-4000-8000-000000000002', 'admin17c@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}'),
  ('9b000000-0000-4000-8000-000000000003', 'caja17c@test.local', 'authenticated', 'authenticated', '{"staff_role":"cashier"}'),
  ('9b000000-0000-4000-8000-000000000004', 'cliente17c@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');

create function pg_temp.as_user(p_id text, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":{"staff_role":"' || p_role || '"}}', true);
$$;
create function pg_temp.as_warehouse() returns void language sql as $$
  select pg_temp.as_user('9b000000-0000-4000-8000-000000000001', 'warehouse');
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.as_user('9b000000-0000-4000-8000-000000000002', 'admin');
$$;
create function pg_temp.as_cashier() returns void language sql as $$
  select pg_temp.as_user('9b000000-0000-4000-8000-000000000003', 'cashier');
$$;
create function pg_temp.as_customer() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"9b000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"customer_type":"retail"}}', true);
$$;
-- Rows a direct update of the product settings reaches (RLS: admin only).
create function pg_temp.direct_product_update() returns integer language plpgsql as $$
declare n integer;
begin
  update public.products set low_stock_threshold = 1 where id = '9a000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Idempotency keys
-- ---------------------------------------------------------------------------

select pg_temp.as_warehouse();
set local role authenticated;

create temporary table t_entry as
  select public.record_stock_entry('9a000000-0000-4000-8000-000000000001', 20, 'FC-17C',
    'ab000000-0000-4000-8000-000000000001') as id;

select throws_ok(
  $$select public.record_stock_entry('9a000000-0000-4000-8000-000000000001', 5, 'FC-17C', null)$$,
  '22023', 'inventory_missing_idempotency_key',
  'keys: a movement without idempotency key is rejected'
);
select is(
  public.record_stock_entry('9a000000-0000-4000-8000-000000000001', 20, 'FC-17C', 'ab000000-0000-4000-8000-000000000001'),
  (select id from t_entry),
  'keys: the same key, product and type returns the same movement'
);
select throws_ok(
  $$select public.record_stock_entry('9a000000-0000-4000-8000-000000000002', 20, 'FC-17C', 'ab000000-0000-4000-8000-000000000001')$$,
  '22023', 'inventory_idempotency_key_conflict',
  'keys: the same key for another product is a conflict'
);
select throws_ok(
  $$select public.record_waste('9a000000-0000-4000-8000-000000000001', 1, 'Rotura', 'ab000000-0000-4000-8000-000000000001')$$,
  '22023', 'inventory_idempotency_key_conflict',
  'keys: the same key for another movement type is a conflict'
);
select throws_ok(
  $$select public.record_count('9a000000-0000-4000-8000-000000000001', 3, 'Conteo', 'ab000000-0000-4000-8000-000000000001')$$,
  '22023', 'inventory_idempotency_key_conflict',
  'keys: a count cannot reuse an entry key'
);

reset role;
select pg_temp.as_admin();
set local role authenticated;
select throws_ok(
  $$select public.record_stock_entry('9a000000-0000-4000-8000-000000000001', 20, 'FC-17C', 'ab000000-0000-4000-8000-000000000001')$$,
  '22023', 'inventory_idempotency_key_conflict',
  'keys: another user cannot reuse a key'
);

reset role;
select pg_temp.as_warehouse();
set local role authenticated;

create temporary table t_count as
  select public.record_count('9a000000-0000-4000-8000-000000000001', 18, 'Conteo semanal',
    'ab000000-0000-4000-8000-000000000002') as id;
select is(
  public.record_count('9a000000-0000-4000-8000-000000000001', 18, 'Conteo semanal', 'ab000000-0000-4000-8000-000000000002'),
  (select id from t_count),
  'keys: a repeated count returns the same adjustment, not "no difference"'
);
select throws_ok(
  $$select public.record_waste('9a000000-0000-4000-8000-000000000001', 1, repeat('x', 301), gen_random_uuid())$$,
  '22023', 'inventory_invalid_reason',
  'movements: a reason longer than 300 characters is rejected'
);
select throws_ok(
  $$select public.record_stock_entry('9a000000-0000-4000-8000-000000000001', 100001, 'FC', gen_random_uuid())$$,
  '22023', 'inventory_invalid_units',
  'movements: an entry above 100.000 units is rejected'
);

reset role;
select is(
  (select on_hand from public.product_stock where product_id = '9a000000-0000-4000-8000-000000000001'),
  18, 'movements: the stock reflects one entry and one count'
);

-- ---------------------------------------------------------------------------
-- Stock settings
-- ---------------------------------------------------------------------------

select pg_temp.as_customer();
set local role authenticated;
select throws_ok(
  $$select public.set_stock_settings('9a000000-0000-4000-8000-000000000001', 5, 2)$$,
  '42501', 'inventory_forbidden', 'settings: a customer cannot change them'
);
select is((select count(*)::int from public.stock_settings_changes), 0, 'settings: a customer reads no history');

reset role;
select pg_temp.as_cashier();
set local role authenticated;
select throws_ok(
  $$select public.set_stock_settings('9a000000-0000-4000-8000-000000000001', 5, 2)$$,
  '42501', 'inventory_forbidden', 'settings: a cashier cannot change them'
);

reset role;
select pg_temp.as_warehouse();
set local role authenticated;
select is(
  public.set_stock_settings('9a000000-0000-4000-8000-000000000001', 18, 3),
  '{"ok": true, "changed": true}'::jsonb,
  'settings: warehouse changes threshold and safety stock'
);
select is(
  public.set_stock_settings('9a000000-0000-4000-8000-000000000001', 18, 3),
  '{"ok": true, "changed": false}'::jsonb,
  'settings: the same values are not recorded again'
);
select throws_ok(
  $$select public.set_stock_settings('9a000000-0000-4000-8000-000000000001', -1, 0)$$,
  '22023', 'inventory_invalid_settings', 'settings: negative values are rejected'
);
select throws_ok(
  $$select public.set_stock_settings('9a000000-0000-4000-8000-000000000099', 1, 0)$$,
  '22023', 'inventory_unknown_product', 'settings: an unknown product is rejected'
);
select results_eq(
  $$select old_low_stock_threshold, new_low_stock_threshold, old_web_safety_stock, new_web_safety_stock, changed_by
    from public.stock_settings_changes$$,
  $$values (0, 18, 0, 3, '9b000000-0000-4000-8000-000000000001'::uuid)$$,
  'settings: the history keeps old and new values and who changed them'
);
select throws_ok(
  $$insert into public.stock_settings_changes (product_id, old_low_stock_threshold, new_low_stock_threshold, old_web_safety_stock, new_web_safety_stock)
    values ('9a000000-0000-4000-8000-000000000001', 0, 0, 0, 0)$$,
  '42501', null, 'settings: nobody writes the history directly'
);
select is(pg_temp.direct_product_update(), 0, 'settings: warehouse cannot update products directly');

reset role;
select throws_ok(
  $$update public.stock_settings_changes set new_web_safety_stock = 9$$,
  null, null, 'settings: the history is insert-only, even for postgres'
);
select is(
  (select low_stock_threshold || '/' || web_safety_stock from public.products where id = '9a000000-0000-4000-8000-000000000001'),
  '18/3', 'settings: the product keeps the new values'
);

-- ---------------------------------------------------------------------------
-- Panel reads
-- ---------------------------------------------------------------------------

select pg_temp.as_warehouse();
set local role authenticated;
select results_eq(
  $$select on_hand, reserved, available, low_stock_threshold, web_safety_stock, is_low
    from public.inventory_overview() where product_id = '9a000000-0000-4000-8000-000000000001'$$,
  $$values (18, 0, 18, 18, 3, true)$$,
  'overview: balance, settings and low stock at the threshold'
);
select ok(
  (select is_low from public.inventory_overview() where product_id = '9a000000-0000-4000-8000-000000000002'),
  'overview: a product with no stock and threshold 0 is low'
);
-- Both movements share now() inside this test transaction, so their order is
-- not defined here; the newest-first order is covered by the end-to-end test.
select set_eq(
  $$select movement_type::text, units, recorded_by
    from public.inventory_recent_movements('9a000000-0000-4000-8000-000000000001')$$,
  $$values ('adjustment', -2, 'bodega17c@test.local'), ('purchase_in', 20, 'bodega17c@test.local')$$,
  'movements list: filtered by product, with who recorded them'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.reserve_stock('ORDER-17C', '[{"product_id":"9a000000-0000-4000-8000-000000000001","units":2}]'::jsonb);
select pg_temp.as_warehouse();
set local role authenticated;
select is(
  (select count(*)::int from public.inventory_recent_movements('9a000000-0000-4000-8000-000000000001')),
  2, 'movements list: reservations are left out by default'
);
select is(
  (select count(*)::int from public.inventory_recent_movements('9a000000-0000-4000-8000-000000000001', true)),
  3, 'movements list: and included when asked for'
);
select is(
  (select count(*)::int from public.inventory_recent_movements(null, true, 1)),
  1, 'movements list: the limit is respected'
);
select is(
  public.inventory_alerts() ->> 'stock_mismatches', '0', 'alerts: the ledger matches the balance'
);
select throws_ok(
  $$select public.admin_summary()$$, '42501', 'admin_forbidden', 'summary: warehouse does not see the panel home'
);

reset role;
select pg_temp.as_cashier();
set local role authenticated;
select throws_ok(
  $$select * from public.inventory_overview()$$, '42501', 'inventory_forbidden', 'overview: a cashier cannot read it'
);

reset role;
select pg_temp.as_customer();
set local role authenticated;
select throws_ok(
  $$select * from public.inventory_recent_movements()$$, '42501', 'inventory_forbidden', 'movements list: a customer cannot read it'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.inventory_alerts()$$, '42501', null, 'alerts: a visitor cannot call them'
);

reset role;
select pg_temp.as_admin();
set local role authenticated;
select ok(
  (public.admin_summary() ->> 'low_stock')::int >= 2
    and public.admin_summary() ->> 'stock_mismatches' = '0',
  'summary: the panel home counts low stock and mismatches'
);

reset role;
select hasnt_function('private', 'movement_by_key', array['uuid'], 'cleanup: the unused key lookup of D-038 is gone');

select * from finish();
rollback;
