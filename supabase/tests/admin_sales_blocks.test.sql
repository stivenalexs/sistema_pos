-- Tests for the admin panel, part D-2b: sales block rules (plan step 17d-2b, D-060).
-- Run with `npm run db:test`. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('d6000000-0000-4000-8000-000000000001', 'admin17d2b@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}'),
  ('d6000000-0000-4000-8000-000000000002', 'caja17d2b@test.local', 'authenticated', 'authenticated', '{"staff_role":"cashier"}');

create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"d6000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"staff_role":"admin"}}', true);
$$;
create function pg_temp.as_cashier() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"d6000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"staff_role":"cashier"}}', true);
$$;
create function pg_temp.zone(p_name text) returns uuid language sql as $$
  select id from public.delivery_zones where municipality = p_name;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

select pg_temp.as_cashier();
set local role authenticated;
select throws_ok($$select public.admin_sales_blocks_overview()$$, '42501', 'admin_forbidden',
  'overview: a cashier cannot read it');
select throws_ok(
  $$insert into public.sales_blocks (name, kind, starts_at, ends_at, message)
    values ('Intruso', 'date_range', now(), now() + interval '1 hour', 'No vender')$$,
  '42501', null, 'rules: a cashier cannot create one'
);
reset role;
set local role anon;
select throws_ok($$select public.admin_sales_blocks_overview()$$, '42501', null, 'overview: a visitor cannot call it');
reset role;

-- ---------------------------------------------------------------------------
-- Rules and what is blocked now
-- ---------------------------------------------------------------------------

select pg_temp.as_admin();
set local role authenticated;
insert into public.sales_blocks (name, kind, zone_id, starts_at, ends_at, message) values
  ('Ley seca Medellín', 'date_range', pg_temp.zone('Medellín'),
   now() - interval '1 hour', now() + interval '2 hours', 'Ley seca por elecciones en Medellín.');
insert into public.sales_blocks (name, kind, channels, starts_at, ends_at, message) values
  ('Mantenimiento web', 'date_range', array['web'],
   now() - interval '10 minutes', now() + interval '30 minutes', 'La tienda web vuelve en media hora.');
reset role;
create temporary table t_rules as select id, name from public.sales_blocks;
grant select on t_rules to authenticated;
create function pg_temp.rule(p_name text) returns uuid language sql as $$ select id from t_rules where name = p_name $$;
grant execute on function pg_temp.rule(text) to authenticated;
select pg_temp.as_admin();
set local role authenticated;

select is(
  (select count(*)::int from jsonb_array_elements(public.admin_sales_blocks_overview() -> 'blocked_now')),
  11, 'now: Medellín on web and POS, and the other nine municipalities on web'
);
select is(
  (select b ->> 'name' from jsonb_array_elements(public.admin_sales_blocks_overview() -> 'blocked_now') b
   where b ->> 'municipality' = 'Medellín' and b ->> 'channel' = 'web'),
  'Ley seca Medellín', 'now: with several rules, the one that lasts longest'
);
select is(
  (select b ->> 'name' from jsonb_array_elements(public.admin_sales_blocks_overview() -> 'blocked_now') b
   where b ->> 'municipality' = 'Bello' and b ->> 'channel' = 'pos'),
  null, 'now: a web-only rule does not block the POS'
);
select results_eq(
  $$select r ->> 'municipality', r ->> 'created_by', (r ->> 'blocking_until') is not null
    from jsonb_array_elements(public.admin_sales_blocks_overview() -> 'rules') r
    where r ->> 'id' = pg_temp.rule('Ley seca Medellín')::text$$,
  $$values ('Medellín', 'admin17d2b@test.local', true)$$,
  'rules: listed with their municipality, author and whether they block now'
);
select is(public.admin_sales_blocks_overview() ->> 'store_zone_id', pg_temp.zone('Medellín')::text,
  'overview: the store municipality');

update public.sales_blocks set is_active = false where id::text = pg_temp.rule('Mantenimiento web')::text;
select is(
  (select count(*)::int from jsonb_array_elements(public.admin_sales_blocks_overview() -> 'blocked_now')),
  2, 'now: a deactivated rule no longer blocks'
);
select is(
  (select r ->> 'blocking_until' from jsonb_array_elements(public.admin_sales_blocks_overview() -> 'rules') r
   where r ->> 'id' = pg_temp.rule('Mantenimiento web')::text),
  null, 'rules: an inactive rule never reports blocking, even inside its window'
);
insert into public.sales_blocks (name, kind, channels, starts_at, ends_at, message) values
  ('Inventario POS', 'date_range', array['pos'], now() - interval '5 minutes', now() + interval '5 hours',
   'La caja está cerrada por inventario.');
select is(
  (select array_agg(b ->> 'municipality') from jsonb_array_elements(public.admin_sales_blocks_overview() -> 'blocked_now') b
   where b ->> 'channel' = 'pos'),
  array['Medellín'], 'now: a department-wide POS rule is one line, at the store municipality'
);
update public.sales_blocks set name = 'Ley seca elecciones' where id::text = pg_temp.rule('Ley seca Medellín')::text;
select results_eq(
  $$select c ->> 'operation', c ->> 'name', c ->> 'actor'
    from jsonb_array_elements(public.admin_sales_blocks_overview() -> 'changes') c
    where c ->> 'block_id' = pg_temp.rule('Ley seca Medellín')::text and c ->> 'operation' = 'update'$$,
  $$values ('update', 'Ley seca elecciones', 'admin17d2b@test.local')$$,
  'history: an edit is listed with who made it'
);

-- ---------------------------------------------------------------------------
-- No deletes, only the rule's own columns
-- ---------------------------------------------------------------------------

select throws_ok($$delete from public.sales_blocks where id::text = pg_temp.rule('Mantenimiento web')::text$$,
  '42501', null, 'rules: never deleted (deactivate instead)');
select throws_ok(
  $$update public.sales_blocks set created_by = 'd6000000-0000-4000-8000-000000000002' where id::text = pg_temp.rule('Ley seca Medellín')::text$$,
  '42501', null, 'rules: the author cannot be rewritten'
);
select throws_ok(
  $$update public.sales_blocks set id = gen_random_uuid() where id::text = pg_temp.rule('Ley seca Medellín')::text$$,
  '42501', null, 'rules: the id (the history key) cannot change'
);
select throws_ok(
  $$insert into public.sales_blocks (id, name, kind, starts_at, ends_at, message)
    values (gen_random_uuid(), 'Con id', 'date_range', now(), now() + interval '1 hour', 'Mensaje')$$,
  '42501', null, 'rules: the id is not chosen on insert'
);
reset role;
select is((select count(*)::int from public.sales_blocks where id in (select id from t_rules)), 2,
  'rules: both rules are still there');

select * from finish();
rollback;
