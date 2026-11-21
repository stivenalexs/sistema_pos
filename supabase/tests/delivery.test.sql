-- Tests for home delivery (plan step 14, D-005, D-007, D-021, D-026, D-045).
-- Uses the sample products and stock of seed.sql. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- Users: two retail customers, one approved wholesale, two own couriers and
-- an administrator. Roles live in app_metadata (raw_app_meta_data).
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('e0000000-0000-4000-8000-000000000001', 'dr1@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('e0000000-0000-4000-8000-000000000002', 'dr2@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('e0000000-0000-4000-8000-000000000003', 'dw1@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('e0000000-0000-4000-8000-000000000011', 'c1@test.local', 'authenticated', 'authenticated', '{"staff_role":"courier"}'),
  ('e0000000-0000-4000-8000-000000000012', 'c2@test.local', 'authenticated', 'authenticated', '{"staff_role":"courier"}'),
  ('e0000000-0000-4000-8000-000000000021', 'a1@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}');
insert into public.customers (id, customer_type, wholesale_status, full_name, phone) values
  ('e0000000-0000-4000-8000-000000000001', 'retail', null, 'Cliente Uno', '3000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'retail', null, 'Cliente Dos', null),
  ('e0000000-0000-4000-8000-000000000003', 'wholesale', 'approved', 'Mayorista Uno', null);

insert into public.couriers (id, provider_id, full_name)
select u.id, p.id, u.email from auth.users u, public.delivery_providers p
where u.id in ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000012')
  and p.kind = 'own';
insert into public.delivery_providers (id, name, kind) values
  ('e1000000-0000-4000-8000-000000000001', 'Tercero de prueba', 'third_party');

-- Addresses at exact distances from the store (straight line, D-021).
create function pg_temp.zone(p text) returns uuid language sql as $$
  select id from public.delivery_zones where municipality = p;
$$;
insert into public.customer_addresses (id, customer_id, label, address_line, zone_id, location) values
  ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'A 1 km', 'Calle de prueba 1',
   pg_temp.zone('Medellín'), extensions.st_project(private.store_location(), 1000, 0)),
  ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'A 1001 m', 'Calle de prueba 2',
   pg_temp.zone('Medellín'), extensions.st_project(private.store_location(), 1001, 0)),
  ('e2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', 'Bodega', 'Calle de prueba 3',
   pg_temp.zone('Itagüí'), extensions.st_project(private.store_location(), 5000, pi())),
  ('e2000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'Lejos', 'Calle de prueba 4',
   pg_temp.zone('Barbosa'), extensions.st_project(private.store_location(), 40000, 0));

create function pg_temp.as_user(p_id text, p_meta text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":' || p_meta || '}', true);
$$;
create function pg_temp.as_r1() returns void language sql as $$
  select pg_temp.as_user('e0000000-0000-4000-8000-000000000001', '{"customer_type":"retail"}');
$$;
create function pg_temp.as_r2() returns void language sql as $$
  select pg_temp.as_user('e0000000-0000-4000-8000-000000000002', '{"customer_type":"retail"}');
$$;
create function pg_temp.as_w1() returns void language sql as $$
  select pg_temp.as_user('e0000000-0000-4000-8000-000000000003', '{"customer_type":"wholesale","wholesale_approved":true}');
$$;
create function pg_temp.as_c1() returns void language sql as $$
  select pg_temp.as_user('e0000000-0000-4000-8000-000000000011', '{"staff_role":"courier"}');
$$;
create function pg_temp.as_c2() returns void language sql as $$
  select pg_temp.as_user('e0000000-0000-4000-8000-000000000012', '{"staff_role":"courier"}');
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.as_user('e0000000-0000-4000-8000-000000000021', '{"staff_role":"admin"}');
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Zones and fees (public)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select count(*)::int from public.delivery_zones), 10, 'zones: a visitor sees the 10 municipalities of the Valle de Aburrá');
select is((select count(*)::int from public.delivery_fee_rules), 3, 'fees: a visitor sees the fee rules');
select throws_ok(
  $$select public.save_delivery_address('Casa', 'Calle 1 # 2-3', null, null, 6.25, -75.58)$$,
  '42501', null, 'address: a visitor cannot save addresses'
);
reset role;

-- ---------------------------------------------------------------------------
-- Addresses
-- ---------------------------------------------------------------------------

update public.delivery_zones set is_active = false where municipality = 'Barbosa';

select pg_temp.as_r1();
set local role authenticated;
select isnt(
  public.save_delivery_address('Casa', 'Calle 10 # 43-20', 'Apto 301', pg_temp.zone('Medellín'), 6.2500, -75.5700),
  null, 'address: a customer saves an address with its point'
);
select throws_ok(
  $$select public.save_delivery_address('Finca', 'Vereda 1 # 1-1', null, pg_temp.zone('Medellín'), 6.60, -75.58)$$,
  '22023', 'address_out_of_range', 'address: a point outside the safety radius is rejected'
);
select throws_ok(
  $$select public.save_delivery_address('Otra', 'Calle 1 # 1-1', null, pg_temp.zone('Barbosa'), 6.25, -75.57)$$,
  '22023', 'address_zone_not_available', 'address: an inactive municipality is rejected'
);
select throws_ok(
  $$select public.save_delivery_address('Mal', 'Calle 1 # 1-1', null, pg_temp.zone('Medellín'), 120, -75.57)$$,
  '22023', 'address_invalid_location', 'address: invalid coordinates are rejected'
);
select is((select count(*)::int from public.get_delivery_addresses()), 4, 'address: the customer lists their own addresses');
select is((select zone_active from public.get_delivery_addresses() where label = 'Lejos'), false,
  'address: one in a deactivated municipality is listed as unavailable');
select throws_ok(
  $$insert into public.customer_addresses (customer_id, label, address_line, zone_id, location)
    values (auth.uid(), 'x', 'Calle 1 # 1-1', pg_temp.zone('Medellín'), private.make_point(6.25, -75.57))$$,
  '42501', null, 'address: direct inserts are not allowed'
);
reset role;

select pg_temp.as_r2();
set local role authenticated;
select is_empty($$select * from public.customer_addresses$$, 'address: another customer cannot see them');
select is(public.delete_delivery_address('e2000000-0000-4000-8000-000000000001'), false,
  'address: another customer cannot delete them');
reset role;

-- ---------------------------------------------------------------------------
-- Delivery fee (D-005)
-- ---------------------------------------------------------------------------

select is(
  private.delivery_quote('e2000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'unit', 0) ->> 'error',
  'zone_not_available', 'fee: no delivery to a deactivated municipality'
);
update public.delivery_zones set is_active = true where municipality = 'Barbosa';

select pg_temp.as_r1();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 2);
select is(
  (select (q ->> 'fee_cop') || ':' || (q ->> 'distance_m')
   from (select public.quote_delivery('e2000000-0000-4000-8000-000000000001') q) s),
  '6000:1000', 'fee: exactly 1 km costs $6.000'
);
select is(public.quote_delivery('e2000000-0000-4000-8000-000000000002') ->> 'fee_cop', '15000',
  'fee: 1.001 m costs $15.000');
select is(public.quote_delivery('e2000000-0000-4000-8000-000000000004') ->> 'error', 'out_of_range',
  'fee: beyond the safety radius there is no delivery');
select is(public.quote_delivery('e2000000-0000-4000-8000-000000000003') ->> 'error', 'address_not_found',
  'fee: another customer''s address cannot be used');
reset role;

select pg_temp.as_w1();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000103', 20);
select is(public.quote_delivery('e2000000-0000-4000-8000-000000000003') ->> 'fee_cop', '0',
  'fee: wholesale with 20 boxes pays no delivery');
select public.set_cart_item('00000000-0000-4000-8000-000000000103', 19);
select is(public.quote_delivery('e2000000-0000-4000-8000-000000000003') ->> 'fee_cop', '15000',
  'fee: wholesale with 19 boxes pays by distance');
reset role;

-- A retail customer never gets the wholesale rule (no boxes).
select is(
  private.delivery_quote('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'unit', 50) ->> 'fee_cop',
  '15000', 'fee: buying by unit never gets the wholesale free delivery'
);

-- ---------------------------------------------------------------------------
-- Order with delivery
-- ---------------------------------------------------------------------------

select pg_temp.as_r1();
set local role authenticated;
create temporary table t_order as
  select public.place_order('e3000000-0000-4000-8000-000000000001', 'delivery', 'e2000000-0000-4000-8000-000000000001') as r;
grant select on t_order to authenticated;
reset role;

create function pg_temp.order_id() returns uuid language sql as $$ select (r ->> 'order_id')::uuid from t_order $$;
grant execute on function pg_temp.order_id() to authenticated;

select is(
  (select status::text || ':' || subtotal_cop || '+' || delivery_fee_cop || '=' || total_cop
   from public.orders where id = pg_temp.order_id()),
  'awaiting_payment:90000+6000=96000', 'order: the delivery fee is added to the total'
);
select is(
  (select (delivery_address ->> 'municipality') || ':' || (delivery_address ->> 'contact_name') || ':' || delivery_distance_m
   from public.orders where id = pg_temp.order_id()),
  'Medellín:Cliente Uno:1000', 'order: keeps a copy of the address, contact and distance'
);

select pg_temp.as_r1();
set local role authenticated;
select public.set_cart_item('00000000-0000-4000-8000-000000000101', 1);
select is(
  public.place_order(gen_random_uuid(), 'delivery', 'e2000000-0000-4000-8000-000000000004') ->> 'reason',
  'out_of_range', 'order: an address beyond the radius is rejected'
);
select is((select count(*)::int from public.orders), 1, 'order: nothing was created for the rejected one');
reset role;

-- Paid (the webhook does this in real life).
update public.orders set status = 'paid', paid_at = now() where id = pg_temp.order_id();

select is(
  (select (l ->> 'final_cop') || ':' || (l ->> 'base_cop') || ':' || (l ->> 'iva_cop')
   from jsonb_array_elements(public.prepare_invoice(pg_temp.order_id()) -> 'lines') l
   where l ->> 'line_kind' = 'delivery'),
  '6000:5714:286', 'invoice: the delivery fee is a line with IVA 5 % computed backwards'
);
select is((select total_cop from public.invoices where order_id = pg_temp.order_id()), 96000::bigint,
  'invoice: the total matches what was charged');

-- ---------------------------------------------------------------------------
-- Assignment (D-026)
-- ---------------------------------------------------------------------------

select pg_temp.as_c1();
set local role authenticated;
select is_empty($$select * from public.orders$$, 'courier: sees no order before assignment');
reset role;

select pg_temp.as_r1();
set local role authenticated;
select throws_ok(
  format($$select public.assign_delivery(%L, (select id from public.delivery_providers where kind = 'own'), 'e0000000-0000-4000-8000-000000000011')$$, pg_temp.order_id()),
  '42501', 'delivery_forbidden', 'assign: a customer cannot assign'
);
reset role;

select pg_temp.as_admin();
set local role authenticated;
select throws_ok(
  format($$select public.assign_delivery(%L, (select id from public.delivery_providers where kind = 'own'))$$, pg_temp.order_id()),
  '22023', 'delivery_invalid_courier', 'assign: an own provider needs a courier'
);
select throws_ok(
  format($$select public.assign_delivery(%L, 'e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000011')$$, pg_temp.order_id()),
  '22023', 'delivery_invalid_courier', 'assign: a third party has no own courier'
);
select throws_ok(
  format($$select public.assign_delivery(%L, (select id from public.delivery_providers where kind = 'own'), 'e0000000-0000-4000-8000-000000000001')$$, pg_temp.order_id()),
  '22023', 'delivery_invalid_courier', 'assign: a customer is not a courier'
);
select lives_ok(
  format($$select public.assign_delivery(%L, (select id from public.delivery_providers where kind = 'own'), 'e0000000-0000-4000-8000-000000000011')$$, pg_temp.order_id()),
  'assign: the administrator assigns an own courier'
);
reset role;

select is((select status::text from public.orders where id = pg_temp.order_id()), 'out_for_delivery',
  'assign: the order is out for delivery');

select pg_temp.as_c1();
set local role authenticated;
select is((select count(*)::int from public.order_items where order_id = pg_temp.order_id()), 1,
  'courier: sees the assigned order and its items');
select ok(public.can_deliver_order(pg_temp.order_id()), 'courier: can deliver the assigned order');
select lives_ok(
  format($$insert into storage.objects (bucket_id, name) values ('delivery-signatures', %L)$$,
         pg_temp.order_id() || '/e4000000-0000-4000-8000-000000000001.png'),
  'signature: the assigned courier uploads it'
);
reset role;

select pg_temp.as_c2();
set local role authenticated;
select is_empty($$select * from public.orders$$, 'courier: another courier does not see it');
select ok(not public.can_deliver_order(pg_temp.order_id()), 'courier: another courier cannot deliver it');
select throws_ok(
  format($$insert into storage.objects (bucket_id, name) values ('delivery-signatures', %L)$$,
         pg_temp.order_id() || '/e4000000-0000-4000-8000-000000000009.png'),
  '42501', null, 'signature: another courier cannot upload it'
);
select throws_ok(
  format($$select public.record_delivery_attempt('e4000000-0000-4000-8000-000000000009', %L, auth.uid(), 'failed', null, null, null, null, 'other', null)$$, pg_temp.order_id()),
  '42501', null, 'proof: only the server records attempts'
);
reset role;

-- ---------------------------------------------------------------------------
-- Proof of delivery (D-007)
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$update public.orders set status = 'delivered' where id = %L$$, pg_temp.order_id()),
  '23514', 'order_delivered_without_proof', 'proof: the order cannot be delivered without a proof'
);

create function pg_temp.attempt(p_key text, p_actor text, p_outcome text, p_name text, p_doc text,
                                p_age boolean, p_reason text) returns jsonb language sql as $$
  select public.record_delivery_attempt(
    p_key::uuid, pg_temp.order_id(), p_actor::uuid, p_outcome::public.delivery_outcome,
    p_name, p_doc, p_age, pg_temp.order_id() || '/' || p_key || '.png', p_reason, null);
$$;

select is(
  pg_temp.attempt('e4000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000011', 'delivered', 'Cliente Uno', '1020304050', true, null) ->> 'error',
  'signature_missing', 'proof: without the signature it is not delivered'
);
select is(
  pg_temp.attempt('e4000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000012', 'delivered', 'Cliente Uno', '1020304050', true, null) ->> 'error',
  'delivery_forbidden', 'proof: a courier who is not assigned cannot deliver'
);
select is(
  pg_temp.attempt('e4000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000011', 'delivered', 'Cliente Uno', '1020304050', false, null) ->> 'error',
  'age_not_confirmed', 'proof: without confirming legal age it is not delivered'
);
select is(
  pg_temp.attempt('e4000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000011', 'delivered', 'Cliente Uno', '12ab', true, null) ->> 'error',
  'invalid_document_number', 'proof: the cédula number must be digits'
);
select is(
  pg_temp.attempt('e4000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000011', 'failed', null, null, null, 'vehicle_breakdown') ->> 'outcome',
  'failed', 'proof: a failed attempt is recorded'
);
select is((select status::text || ':' || (courier_id is null) from public.orders where id = pg_temp.order_id()),
  'preparing:true', 'proof: after a failed attempt the order returns to the store, unassigned (D-068)');
-- Assigned again to go on with the delivery.
select pg_temp.as_admin();
set local role authenticated;
select public.assign_delivery(pg_temp.order_id(),
  (select id from public.delivery_providers where kind = 'own'), 'e0000000-0000-4000-8000-000000000011');
reset role;

select is(
  pg_temp.attempt('e4000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000011', 'delivered', 'Cliente Uno', '1020304050', true, null) ->> 'outcome',
  'delivered', 'proof: name, cédula, age and signature deliver the order'
);
select is(
  pg_temp.attempt('e4000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000011', 'delivered', 'Cliente Uno', '1020304050', true, null) ->> 'duplicate',
  'true', 'proof: retrying the confirmation does not duplicate it'
);
select is(
  (select o.status::text || ':' || (o.delivered_at is not null) || ':' || count(p.id)
   from public.orders o left join public.delivery_proofs p on p.order_id = o.id
   where o.id = pg_temp.order_id() group by o.id),
  'delivered:true:1', 'proof: the order is delivered with exactly one proof'
);

select pg_temp.as_r1();
set local role authenticated;
select is_empty($$select * from public.delivery_proofs$$, 'proof: the customer cannot read the cédula or signature');
reset role;

select pg_temp.as_admin();
set local role authenticated;
select is((select count(*)::int from public.delivery_proofs), 1, 'proof: the administrator reads it');
reset role;

select throws_ok(
  $$update public.delivery_proofs set recipient_document_number = '1'$$,
  '42501', null, 'proof: it cannot be changed'
);

select * from finish();
rollback;
