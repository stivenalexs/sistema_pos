-- Home delivery (plan step 14, D-005, D-006, D-007, D-021, D-026, D-045).
--
-- - Delivery only to the municipalities of the Valle de Aburrá (configurable
--   zones). The customer picks the municipality from a list and marks the
--   point on a map; the distance is measured in a straight line with PostGIS
--   from the store to that point, in whole meters.
-- - Fees live in delivery_fee_rules (D-005): the cheapest active rule that
--   matches wins. Defaults: up to 1 km $6.000, more than 1 km $15.000,
--   wholesale with 20 boxes or more free.
-- - Couriers: own (users with staff_role courier) or third parties, assigned
--   by hand by an administrator (D-026).
-- - Proof of delivery (D-007): recipient name, cédula number, age confirmed
--   and signature (PNG in the private bucket delivery-signatures). A web
--   order can never become 'delivered' without a proof (trigger).
-- - The delivery fee is part of the order total (Wompi) and goes to the
--   invoice as its own line with IVA (PROJECT ASSUMPTION, D-045).
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  -- PROJECT ASSUMPTION (D-045): a point in Medellín until the real store
  -- location is set by the administrator.
  ('store_location', '{"lat": 6.2442, "lng": -75.5812}'::jsonb),
  -- Safety radius from the store, on top of the municipality list.
  ('delivery_max_distance_m', '30000'::jsonb);

-- ---------------------------------------------------------------------------
-- Zones, fee rules, providers and couriers
-- ---------------------------------------------------------------------------

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  municipality text not null check (length(trim(municipality)) > 0),
  dane_code text not null check (dane_code ~ '^[0-9]{5}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_zones_municipality_key unique (municipality),
  constraint delivery_zones_dane_code_key unique (dane_code)
);

-- The ten municipalities of the Valle de Aburrá (D-045).
insert into public.delivery_zones (municipality, dane_code) values
  ('Medellín', '05001'),
  ('Bello', '05088'),
  ('Itagüí', '05360'),
  ('Envigado', '05266'),
  ('Sabaneta', '05631'),
  ('La Estrella', '05380'),
  ('Caldas', '05129'),
  ('Copacabana', '05212'),
  ('Girardota', '05308'),
  ('Barbosa', '05079');

create table public.delivery_fee_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  -- Null: any customer type. Wholesale means buying by box (approved).
  customer_type public.customer_type,
  -- Null: any number of boxes.
  min_boxes integer check (min_boxes > 0),
  -- Null: any distance (within the safety radius).
  max_distance_m integer check (max_distance_m > 0),
  fee_cop bigint not null check (fee_cop >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- D-005. The store pays the shipping of wholesale orders of 20+ boxes.
insert into public.delivery_fee_rules (name, customer_type, min_boxes, max_distance_m, fee_cop) values
  ('Hasta 1 km', null, null, 1000, 6000),
  ('Más de 1 km', null, null, null, 15000),
  ('Mayorista con 20 cajas o más', 'wholesale', 20, null, 0);

create type public.delivery_provider_kind as enum ('own', 'third_party');

create table public.delivery_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  kind public.delivery_provider_kind not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_providers_name_key unique (name)
);

insert into public.delivery_providers (name, kind) values ('Mensajeros propios', 'own');

-- Own couriers: users with staff_role courier, created by the server.
create table public.couriers (
  id uuid primary key references auth.users (id) on delete restrict,
  provider_id uuid not null references public.delivery_providers (id) on delete restrict,
  full_name text not null check (length(trim(full_name)) > 0),
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.delivery_zones
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.delivery_fee_rules
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.delivery_providers
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.couriers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Customer addresses
-- ---------------------------------------------------------------------------

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 60),
  address_line text not null check (length(trim(address_line)) between 5 and 200),
  details text check (details is null or length(details) <= 200),
  zone_id uuid not null references public.delivery_zones (id) on delete restrict,
  -- Marked by the customer on the map (P-010, D-045).
  location extensions.geography(Point, 4326) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customer_addresses_customer_idx on public.customer_addresses (customer_id, created_at);

create trigger set_updated_at before update on public.customer_addresses
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Orders: delivery data
-- ---------------------------------------------------------------------------

alter table public.orders
  -- Snapshot at order time: address, municipality, point and contact.
  add column delivery_address jsonb,
  add column delivery_distance_m integer check (delivery_distance_m >= 0),
  add column delivery_provider_id uuid references public.delivery_providers (id) on delete restrict,
  add column courier_id uuid references public.couriers (id) on delete restrict,
  -- Third-party guide or reference, typed by the administrator.
  add column delivery_external_ref text check (delivery_external_ref is null or length(delivery_external_ref) <= 100),
  add column assigned_at timestamptz,
  add column delivered_at timestamptz,
  add constraint orders_delivery_address_check check (
    fulfillment <> 'delivery' or (delivery_address is not null and delivery_distance_m is not null)
  );

create index orders_courier_idx on public.orders (courier_id, status) where courier_id is not null;

-- ---------------------------------------------------------------------------
-- Delivery attempts and proofs (insert only)
-- ---------------------------------------------------------------------------

create type public.delivery_outcome as enum ('delivered', 'failed');

create table public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  actor_id uuid not null references auth.users (id) on delete restrict,
  outcome public.delivery_outcome not null,
  failure_reason text check (failure_reason in (
    'recipient_underage', 'no_id_document', 'recipient_absent', 'refused', 'other'
  )),
  notes text check (notes is null or length(notes) <= 500),
  location extensions.geography(Point, 4326),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint delivery_attempts_idempotency_key_key unique (idempotency_key),
  constraint delivery_attempts_reason_check check ((outcome = 'failed') = (failure_reason is not null))
);

create index delivery_attempts_order_idx on public.delivery_attempts (order_id, created_at);

create table public.delivery_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  attempt_id uuid not null references public.delivery_attempts (id) on delete restrict,
  recipient_name text not null check (length(trim(recipient_name)) between 3 and 120),
  -- Cédula number shown by the recipient (D-007). Digits only.
  recipient_document_number text not null check (recipient_document_number ~ '^[0-9]{5,12}$'),
  age_confirmed boolean not null check (age_confirmed),
  -- Object name in the private bucket delivery-signatures.
  signature_path text not null,
  delivered_by uuid not null references auth.users (id) on delete restrict,
  delivered_at timestamptz not null default now(),
  constraint delivery_proofs_order_key unique (order_id),
  constraint delivery_proofs_attempt_key unique (attempt_id)
);

create trigger delivery_attempts_insert_only before update or delete on public.delivery_attempts
  for each row execute function private.forbid_change();
create trigger delivery_proofs_insert_only before update or delete on public.delivery_proofs
  for each row execute function private.forbid_change();

-- A web order is never 'delivered' without its proof (D-007).
create function private.require_delivery_proof()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.channel = 'web'
     and not exists (select 1 from public.delivery_proofs where order_id = new.id) then
    raise exception 'order_delivered_without_proof' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger require_delivery_proof
  before update of status on public.orders
  for each row execute function private.require_delivery_proof();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on public.delivery_zones, public.delivery_fee_rules from anon;
grant select on public.delivery_zones, public.delivery_fee_rules to anon;
revoke all on public.delivery_providers, public.couriers, public.customer_addresses,
  public.delivery_attempts, public.delivery_proofs from anon;
revoke insert, update, delete on public.customer_addresses, public.delivery_attempts, public.delivery_proofs
  from authenticated;

alter table public.delivery_zones enable row level security;
alter table public.delivery_fee_rules enable row level security;
alter table public.delivery_providers enable row level security;
alter table public.couriers enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.delivery_attempts enable row level security;
alter table public.delivery_proofs enable row level security;

-- Zones and fees are public information (shown before buying).
create policy "delivery_zones: everyone reads active"
  on public.delivery_zones for select to anon, authenticated
  using (is_active or (select private.has_staff_role(array['admin'])));
create policy "delivery_zones: admin inserts"
  on public.delivery_zones for insert to authenticated
  with check ((select private.has_staff_role(array['admin'])));
create policy "delivery_zones: admin updates"
  on public.delivery_zones for update to authenticated
  using ((select private.has_staff_role(array['admin'])))
  with check ((select private.has_staff_role(array['admin'])));

create policy "delivery_fee_rules: everyone reads active"
  on public.delivery_fee_rules for select to anon, authenticated
  using (is_active or (select private.has_staff_role(array['admin'])));
create policy "delivery_fee_rules: admin inserts"
  on public.delivery_fee_rules for insert to authenticated
  with check ((select private.has_staff_role(array['admin'])));
create policy "delivery_fee_rules: admin updates"
  on public.delivery_fee_rules for update to authenticated
  using ((select private.has_staff_role(array['admin'])))
  with check ((select private.has_staff_role(array['admin'])));
create policy "delivery_fee_rules: admin deletes"
  on public.delivery_fee_rules for delete to authenticated
  using ((select private.has_staff_role(array['admin'])));

create policy "delivery_providers: staff reads"
  on public.delivery_providers for select to authenticated
  using ((select private.has_staff_role(array['admin', 'courier', 'cashier', 'warehouse'])));
create policy "delivery_providers: admin inserts"
  on public.delivery_providers for insert to authenticated
  with check ((select private.has_staff_role(array['admin'])));
create policy "delivery_providers: admin updates"
  on public.delivery_providers for update to authenticated
  using ((select private.has_staff_role(array['admin'])))
  with check ((select private.has_staff_role(array['admin'])));

create policy "couriers: admin reads"
  on public.couriers for select to authenticated
  using ((select private.has_staff_role(array['admin'])));
create policy "couriers: courier reads own"
  on public.couriers for select to authenticated
  using (id = (select auth.uid()));
create policy "couriers: admin inserts"
  on public.couriers for insert to authenticated
  with check ((select private.has_staff_role(array['admin'])));
create policy "couriers: admin updates"
  on public.couriers for update to authenticated
  using ((select private.has_staff_role(array['admin'])))
  with check ((select private.has_staff_role(array['admin'])));

create policy "customer_addresses: read own"
  on public.customer_addresses for select to authenticated
  using (customer_id = (select auth.uid()));

-- Couriers see only the orders assigned to them (and, through the existing
-- policies, their items).
create policy "orders: courier reads assigned"
  on public.orders for select to authenticated
  using (
    courier_id = (select auth.uid())
    and (select private.has_staff_role(array['courier']))
  );

create policy "delivery_attempts: admin reads"
  on public.delivery_attempts for select to authenticated
  using ((select private.has_staff_role(array['admin'])));
create policy "delivery_attempts: actor reads own"
  on public.delivery_attempts for select to authenticated
  using (actor_id = (select auth.uid()));

-- Cédula and signature: only the administrator (data minimization).
create policy "delivery_proofs: admin reads"
  on public.delivery_proofs for select to authenticated
  using ((select private.has_staff_role(array['admin'])));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.make_point(p_lat double precision, p_lng double precision)
returns extensions.geography
language sql
immutable
set search_path = ''
as $$
  select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
$$;

create function private.store_location()
returns extensions.geography
language sql
stable
security definer
set search_path = ''
as $$
  select private.make_point((value ->> 'lat')::double precision, (value ->> 'lng')::double precision)
  from public.app_settings
  where key = 'store_location';
$$;

-- Whole meters, straight line on the spheroid (D-021).
create function private.distance_from_store_m(p_location extensions.geography)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select round(extensions.st_distance(private.store_location(), p_location))::integer;
$$;

-- The internal role stored by the server in app_metadata of a given user.
create function private.user_staff_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select raw_app_meta_data ->> 'staff_role' from auth.users where id = p_user_id;
$$;

-- True when the current user may confirm the delivery of this order: an
-- administrator, or the courier assigned to it, while it is out for delivery.
create function private.can_deliver_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.fulfillment = 'delivery'
      and o.status = 'out_for_delivery'
      and (
        private.has_staff_role(array['admin'])
        or (private.has_staff_role(array['courier']) and o.courier_id = auth.uid())
      )
  );
$$;

-- Signature object names are "<order_id>/<idempotency_key>.png".
create function private.can_upload_delivery_signature(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if coalesce(array_length(v_parts, 1), 0) <> 2
     or v_parts[1] !~ (v_uuid || '$')
     or v_parts[2] !~ (v_uuid || '\.png$') then
    return false;
  end if;
  return private.can_deliver_order(v_parts[1]::uuid);
end;
$$;

-- Fee and snapshot for delivering the given cart to one of the customer's
-- addresses. Returns {"ok": true, fee_cop, distance_m, rule_name, address}
-- or {"ok": false, "error": address_not_found | zone_not_available |
-- store_location_missing | out_of_range | no_fee_rule}.
create function private.delivery_quote(
  p_address_id uuid,
  p_customer_id uuid,
  p_sale_unit text,
  p_total_boxes integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_address record;
  v_store extensions.geography := private.store_location();
  v_distance integer;
  v_type public.customer_type :=
    (case when p_sale_unit = 'box' then 'wholesale' else 'retail' end)::public.customer_type;
  v_rule public.delivery_fee_rules;
begin
  select a.*, z.municipality, z.dane_code, z.is_active as zone_active,
         extensions.st_y(a.location::extensions.geometry) as lat,
         extensions.st_x(a.location::extensions.geometry) as lng,
         c.full_name as contact_name, c.phone as contact_phone
  into v_address
  from public.customer_addresses a
  join public.delivery_zones z on z.id = a.zone_id
  join public.customers c on c.id = a.customer_id
  where a.id = p_address_id and a.customer_id = p_customer_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'address_not_found');
  end if;
  if not v_address.zone_active then
    return jsonb_build_object('ok', false, 'error', 'zone_not_available');
  end if;
  if v_store is null then
    return jsonb_build_object('ok', false, 'error', 'store_location_missing');
  end if;

  v_distance := round(extensions.st_distance(v_store, v_address.location))::integer;
  if v_distance > private.setting_integer('delivery_max_distance_m', 30000) then
    return jsonb_build_object('ok', false, 'error', 'out_of_range', 'distance_m', v_distance);
  end if;

  -- The cheapest active rule that matches wins (D-005, D-045).
  select * into v_rule
  from public.delivery_fee_rules r
  where r.is_active
    and (r.customer_type is null or r.customer_type = v_type)
    and (r.min_boxes is null or coalesce(p_total_boxes, 0) >= r.min_boxes)
    and (r.max_distance_m is null or v_distance <= r.max_distance_m)
  order by r.fee_cop, r.max_distance_m nulls last
  limit 1;

  if v_rule.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_fee_rule');
  end if;

  return jsonb_build_object(
    'ok', true,
    'fee_cop', v_rule.fee_cop,
    'distance_m', v_distance,
    'rule_name', v_rule.name,
    'address', jsonb_build_object(
      'address_id', v_address.id,
      'label', v_address.label,
      'address_line', v_address.address_line,
      'details', v_address.details,
      'municipality', v_address.municipality,
      'dane_code', v_address.dane_code,
      'lat', v_address.lat,
      'lng', v_address.lng,
      'contact_name', v_address.contact_name,
      'contact_phone', v_address.contact_phone
    )
  );
end;
$$;

revoke all on function
  private.make_point(double precision, double precision),
  private.store_location(),
  private.distance_from_store_m(extensions.geography),
  private.user_staff_role(uuid),
  private.can_deliver_order(uuid),
  private.can_upload_delivery_signature(text),
  private.delivery_quote(uuid, uuid, text, integer),
  private.require_delivery_proof()
from public;

grant execute on function
  private.can_deliver_order(uuid),
  private.can_upload_delivery_signature(text),
  private.delivery_quote(uuid, uuid, text, integer)
to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: signatures (private bucket)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-signatures', 'delivery-signatures', false, 204800, array['image/png']);

create policy "delivery signatures: courier uploads for assigned orders"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-signatures'
    and private.can_upload_delivery_signature(name)
  );

create policy "delivery signatures: admin reads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-signatures'
    and (select private.has_staff_role(array['admin']))
  );

-- ---------------------------------------------------------------------------
-- Addresses (signed-in customers)
-- ---------------------------------------------------------------------------

-- Saves a delivery address of the caller. The point must be inside the
-- safety radius and the municipality must be an active zone.
create function public.save_delivery_address(
  p_label text,
  p_address_line text,
  p_details text,
  p_zone_id uuid,
  p_lat double precision,
  p_lng double precision
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_location extensions.geography;
  v_label text := trim(coalesce(p_label, ''));
  v_line text := trim(coalesce(p_address_line, ''));
  v_details text := nullif(trim(coalesce(p_details, '')), '');
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.customers where id = v_uid) then
    raise exception 'address_requires_customer' using errcode = '42501';
  end if;
  if length(v_label) not between 1 and 60 or length(v_line) not between 5 and 200
     or length(coalesce(v_details, '')) > 200 then
    raise exception 'address_invalid_field' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'address_invalid_location' using errcode = '22023';
  end if;
  if not exists (select 1 from public.delivery_zones where id = p_zone_id and is_active) then
    raise exception 'address_zone_not_available' using errcode = '22023';
  end if;

  v_location := private.make_point(p_lat, p_lng);
  if private.store_location() is null
     or private.distance_from_store_m(v_location) > private.setting_integer('delivery_max_distance_m', 30000) then
    raise exception 'address_out_of_range' using errcode = '22023';
  end if;

  if (select count(*) from public.customer_addresses where customer_id = v_uid) >= 10 then
    raise exception 'address_too_many' using errcode = '22023';
  end if;

  insert into public.customer_addresses (customer_id, label, address_line, details, zone_id, location)
  values (v_uid, v_label, v_line, v_details, p_zone_id, v_location)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.delete_delivery_address(p_address_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Orders keep their own copy of the address, so deleting is safe.
  delete from public.customer_addresses where id = p_address_id and customer_id = auth.uid();
  return found;
end;
$$;

-- The caller's addresses with their point, for the cart and the map.
-- SECURITY DEFINER so that an address in a deactivated municipality is still
-- listed (marked as unavailable); it only returns the caller's own rows.
create function public.get_delivery_addresses()
returns table (
  id uuid,
  label text,
  address_line text,
  details text,
  zone_id uuid,
  municipality text,
  zone_active boolean,
  lat double precision,
  lng double precision,
  distance_m integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.label, a.address_line, a.details, a.zone_id, z.municipality, z.is_active,
         extensions.st_y(a.location::extensions.geometry),
         extensions.st_x(a.location::extensions.geometry),
         private.distance_from_store_m(a.location)
  from public.customer_addresses a
  join public.delivery_zones z on z.id = a.zone_id
  where a.customer_id = auth.uid()
  order by a.created_at;
$$;

grant execute on function private.distance_from_store_m(extensions.geography) to authenticated;

-- Delivery fee of the caller's current cart to one of their addresses.
create function public.quote_delivery(p_address_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_items jsonb;
  v_quote jsonb;
begin
  if v_uid is null or not exists (select 1 from public.customers where id = v_uid) then
    raise exception 'delivery_requires_customer' using errcode = '42501';
  end if;
  v_items := public.get_cart_items();
  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'cart_empty');
  end if;
  v_quote := public.quote_items(v_items);
  if not (v_quote ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'quote_failed');
  end if;
  return private.delivery_quote(
    p_address_id, v_uid, v_quote ->> 'sale_unit', (v_quote ->> 'total_boxes')::integer
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order with delivery (replaces the step 11 versions)
-- ---------------------------------------------------------------------------

drop function public.place_order(uuid, public.fulfillment_method);
drop function private.create_web_order(uuid, uuid, public.fulfillment_method, jsonb);

create function private.create_web_order(
  p_customer_id uuid,
  p_idempotency_key uuid,
  p_fulfillment public.fulfillment_method,
  p_quote jsonb,
  p_address_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action_id uuid;
  v_existing public.actions;
  v_order_id uuid;
  v_ttl integer := private.setting_integer('reservation_ttl_minutes', 30);
  v_window integer := private.setting_integer('order_payment_window_hours', 24);
  v_line jsonb;
  v_reserve jsonb := '[]'::jsonb;
  v_delivery jsonb;
  v_fee bigint := 0;
  v_subtotal bigint := (p_quote ->> 'total_cop')::bigint;
begin
  -- Layer 3 of idempotency: the action key is UNIQUE. A concurrent second
  -- call waits here for the first one and then returns its result.
  insert into public.actions (idempotency_key, type, user_id, status, payload, attempts, started_at)
  values (p_idempotency_key, 'place_order', p_customer_id, 'processing',
          jsonb_build_object('fulfillment', p_fulfillment, 'address_id', p_address_id), 1, now())
  on conflict (idempotency_key) do nothing
  returning id into v_action_id;

  if v_action_id is null then
    select * into v_existing from public.actions where idempotency_key = p_idempotency_key;
    if v_existing.user_id is distinct from p_customer_id or v_existing.type <> 'place_order' then
      raise exception 'idempotency_key_conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'ok', true, 'created', false,
      'tracking_id', v_existing.id,
      'order_id', v_existing.result ->> 'order_id'
    );
  end if;

  if p_fulfillment = 'delivery' then
    -- The fee is always computed here, never received (agents.md §5.1).
    v_delivery := private.delivery_quote(
      p_address_id, p_customer_id, p_quote ->> 'sale_unit', (p_quote ->> 'total_boxes')::integer
    );
    if not (v_delivery ->> 'ok')::boolean then
      raise exception 'order_delivery_unavailable'
        using errcode = '22023', detail = v_delivery ->> 'error';
    end if;
    v_fee := (v_delivery ->> 'fee_cop')::bigint;
  end if;

  insert into public.orders (
    customer_id, channel, status, fulfillment, sale_unit,
    subtotal_cop, delivery_fee_cop, total_cop, total_boxes, total_base_units,
    idempotency_key, payment_deadline, cancel_after,
    delivery_address, delivery_distance_m
  ) values (
    p_customer_id, 'web', 'awaiting_payment', p_fulfillment, p_quote ->> 'sale_unit',
    v_subtotal, v_fee, v_subtotal + v_fee,
    (p_quote ->> 'total_boxes')::integer, (p_quote ->> 'total_base_units')::integer,
    p_idempotency_key, now() + make_interval(mins => v_ttl), now() + make_interval(hours => v_window),
    v_delivery -> 'address', (v_delivery ->> 'distance_m')::integer
  )
  returning id into v_order_id;

  for v_line in select value from jsonb_array_elements(p_quote -> 'lines')
  loop
    insert into public.order_items (
      order_id, product_id, sku, product_name, sale_unit, units_per_box,
      quantity, unit_price_cop, line_total_cop, base_units
    )
    select
      v_order_id, p.id, p.sku, p.name, p_quote ->> 'sale_unit', p.units_per_box,
      (v_line ->> 'quantity')::integer, (v_line ->> 'unit_price_cop')::bigint,
      (v_line ->> 'line_total_cop')::bigint, (v_line ->> 'base_units')::integer
    from public.products p
    where p.id = (v_line ->> 'product_id')::uuid;

    v_reserve := v_reserve || jsonb_build_object(
      'product_id', v_line ->> 'product_id',
      'units', (v_line ->> 'base_units')::integer
    );
  end loop;

  -- All or nothing: an insufficient stock error aborts the whole order.
  perform private.reserve_units(v_order_id::text, v_reserve, v_ttl, p_customer_id);

  delete from public.cart_items
  where cart_id = (select id from public.carts where customer_id = p_customer_id);

  update public.actions
  set status = 'succeeded',
      result = jsonb_build_object('order_id', v_order_id),
      finished_at = now()
  where id = v_action_id;

  return jsonb_build_object(
    'ok', true, 'created', true,
    'tracking_id', v_action_id,
    'order_id', v_order_id
  );
end;
$$;

revoke all on function private.create_web_order(uuid, uuid, public.fulfillment_method, jsonb, uuid) from public;
grant execute on function private.create_web_order(uuid, uuid, public.fulfillment_method, jsonb, uuid) to authenticated;

-- Places a web order from the caller's cart, for pickup or delivery.
-- SECURITY INVOKER: the quote runs with the customer's own permissions.
-- Returns {"ok": true, "created", "tracking_id", "order_id"} or
--         {"ok": false, "error": "cart_empty"|"quote_failed"|"insufficient_stock"
--                                |"delivery_unavailable", ...}
create function public.place_order(
  p_idempotency_key uuid,
  p_fulfillment public.fulfillment_method default 'pickup',
  p_address_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.actions;
  v_items jsonb;
  v_quote jsonb;
  v_detail text;
begin
  if v_uid is null or not exists (select 1 from public.customers where id = v_uid) then
    raise exception 'order_requires_customer' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'order_missing_idempotency_key' using errcode = '22023';
  end if;

  -- A retry of an order already placed returns it, even with an empty cart.
  select * into v_existing from public.actions
  where idempotency_key = p_idempotency_key and user_id = v_uid and type = 'place_order'
    and status = 'succeeded';
  if found then
    return jsonb_build_object(
      'ok', true, 'created', false,
      'tracking_id', v_existing.id,
      'order_id', v_existing.result ->> 'order_id'
    );
  end if;

  v_items := public.get_cart_items();
  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'cart_empty');
  end if;

  v_quote := public.quote_items(v_items);
  if not (v_quote ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'quote_failed', 'quote', v_quote);
  end if;

  begin
    return private.create_web_order(v_uid, p_idempotency_key, p_fulfillment, v_quote, p_address_id);
  exception when sqlstate '22023' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm = 'inventory_insufficient_stock' then
      return jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'product_id', v_detail);
    end if;
    if sqlerrm = 'order_delivery_unavailable' then
      return jsonb_build_object('ok', false, 'error', 'delivery_unavailable', 'reason', v_detail);
    end if;
    raise;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assignment (administrator) and proof of delivery (worker)
-- ---------------------------------------------------------------------------

-- Assigns a paid delivery order to an own courier or to a third party and
-- marks it out for delivery (D-026). Reassigning while on the way is allowed.
create function public.assign_delivery(
  p_order_id uuid,
  p_provider_id uuid,
  p_courier_id uuid default null,
  p_external_ref text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_provider public.delivery_providers;
begin
  if not (private.is_service_role() or private.has_staff_role(array['admin'])) then
    raise exception 'delivery_forbidden' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.fulfillment <> 'delivery' or v_order.needs_refund
     or v_order.status not in ('paid', 'preparing', 'out_for_delivery') then
    raise exception 'delivery_order_not_assignable' using errcode = '22023';
  end if;

  select * into v_provider from public.delivery_providers where id = p_provider_id and is_active;
  if v_provider.id is null then
    raise exception 'delivery_unknown_provider' using errcode = '22023';
  end if;

  if v_provider.kind = 'own' then
    if p_courier_id is null
       or not exists (
         select 1 from public.couriers
         where id = p_courier_id and provider_id = p_provider_id and is_active
       )
       or private.user_staff_role(p_courier_id) is distinct from 'courier' then
      raise exception 'delivery_invalid_courier' using errcode = '22023';
    end if;
  elsif p_courier_id is not null then
    -- Third parties are tracked by the administrator (D-026).
    raise exception 'delivery_invalid_courier' using errcode = '22023';
  end if;

  update public.orders
  set delivery_provider_id = p_provider_id,
      courier_id = p_courier_id,
      delivery_external_ref = nullif(trim(coalesce(p_external_ref, '')), ''),
      assigned_at = now(),
      status = 'out_for_delivery'
  where id = p_order_id;
end;
$$;

-- Records a delivery attempt checked by the endpoint and processed by the
-- worker (server only). Idempotent by key. A 'delivered' attempt needs the
-- recipient's name, cédula number, age confirmation and the uploaded
-- signature; it writes the proof and marks the order delivered.
-- Returns {"ok": true, attempt_id, outcome, duplicate} or {"ok": false, error}.
create function public.record_delivery_attempt(
  p_idempotency_key uuid,
  p_order_id uuid,
  p_actor_id uuid,
  p_outcome public.delivery_outcome,
  p_recipient_name text,
  p_document_number text,
  p_age_confirmed boolean,
  p_signature_path text,
  p_failure_reason text,
  p_notes text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.delivery_attempts;
  v_order public.orders;
  v_role text := private.user_staff_role(p_actor_id);
  v_attempt_id uuid;
  v_location extensions.geography;
  v_name text := trim(coalesce(p_recipient_name, ''));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  select * into v_existing from public.delivery_attempts where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.order_id <> p_order_id or v_existing.actor_id <> p_actor_id then
      raise exception 'idempotency_key_conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object('ok', true, 'duplicate', true,
                              'attempt_id', v_existing.id, 'outcome', v_existing.outcome);
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.fulfillment <> 'delivery' or v_order.status <> 'out_for_delivery' then
    return jsonb_build_object('ok', false, 'error', 'order_not_out_for_delivery');
  end if;
  if not (v_role = 'admin' or (v_role = 'courier' and v_order.courier_id = p_actor_id)) then
    return jsonb_build_object('ok', false, 'error', 'delivery_forbidden');
  end if;
  if v_notes is not null and length(v_notes) > 500 then
    return jsonb_build_object('ok', false, 'error', 'invalid_notes');
  end if;
  if p_lat is not null and p_lng is not null
     and p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_location := private.make_point(p_lat, p_lng);
  end if;

  if p_outcome = 'failed' then
    if p_failure_reason is null or p_failure_reason not in (
      'recipient_underage', 'no_id_document', 'recipient_absent', 'refused', 'other'
    ) then
      return jsonb_build_object('ok', false, 'error', 'invalid_failure_reason');
    end if;
    insert into public.delivery_attempts
      (order_id, actor_id, outcome, failure_reason, notes, location, idempotency_key)
    values (p_order_id, p_actor_id, 'failed', p_failure_reason, v_notes, v_location, p_idempotency_key)
    returning id into v_attempt_id;
    return jsonb_build_object('ok', true, 'duplicate', false, 'attempt_id', v_attempt_id, 'outcome', 'failed');
  end if;

  -- Delivered: every piece of the proof is required (D-007).
  if p_age_confirmed is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'age_not_confirmed');
  end if;
  if length(v_name) not between 3 and 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_recipient_name');
  end if;
  if coalesce(p_document_number, '') !~ '^[0-9]{5,12}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_document_number');
  end if;
  if p_signature_path is distinct from (p_order_id::text || '/' || p_idempotency_key::text || '.png')
     or not exists (
       select 1 from storage.objects
       where bucket_id = 'delivery-signatures' and name = p_signature_path
     ) then
    return jsonb_build_object('ok', false, 'error', 'signature_missing');
  end if;

  insert into public.delivery_attempts
    (order_id, actor_id, outcome, failure_reason, notes, location, idempotency_key)
  values (p_order_id, p_actor_id, 'delivered', null, v_notes, v_location, p_idempotency_key)
  returning id into v_attempt_id;

  insert into public.delivery_proofs (
    order_id, attempt_id, recipient_name, recipient_document_number,
    age_confirmed, signature_path, delivered_by
  ) values (
    p_order_id, v_attempt_id, v_name, p_document_number, true, p_signature_path, p_actor_id
  );

  update public.orders
  set status = 'delivered', delivered_at = now()
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'attempt_id', v_attempt_id, 'outcome', 'delivered');
end;
$$;

-- For the endpoint, with the caller's session.
create function public.can_deliver_order(p_order_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.can_deliver_order(p_order_id);
$$;

revoke all on function
  public.save_delivery_address(text, text, text, uuid, double precision, double precision),
  public.delete_delivery_address(uuid),
  public.get_delivery_addresses(),
  public.quote_delivery(uuid),
  public.place_order(uuid, public.fulfillment_method, uuid),
  public.assign_delivery(uuid, uuid, uuid, text),
  public.record_delivery_attempt(uuid, uuid, uuid, public.delivery_outcome, text, text, boolean, text, text, text, double precision, double precision),
  public.can_deliver_order(uuid)
from public, anon, authenticated;

grant execute on function
  public.save_delivery_address(text, text, text, uuid, double precision, double precision),
  public.delete_delivery_address(uuid),
  public.get_delivery_addresses(),
  public.quote_delivery(uuid),
  public.place_order(uuid, public.fulfillment_method, uuid),
  public.assign_delivery(uuid, uuid, uuid, text),
  public.can_deliver_order(uuid)
to authenticated;

grant execute on function
  public.assign_delivery(uuid, uuid, uuid, text),
  public.record_delivery_attempt(uuid, uuid, uuid, public.delivery_outcome, text, text, boolean, text, text, text, double precision, double precision)
to service_role;

-- ---------------------------------------------------------------------------
-- Invoice: the delivery fee as its own line (D-045)
-- ---------------------------------------------------------------------------

alter table public.invoice_lines
  add column line_kind text not null default 'product' check (line_kind in ('product', 'delivery')),
  alter column product_id drop not null,
  add constraint invoice_lines_kind_check check ((line_kind = 'product') = (product_id is not null));

-- Same as step 13, plus the delivery line. PROJECT ASSUMPTION (D-045): the
-- fee charged by the seller is part of the sale and carries the same IVA
-- rate (iva_rate_pct), computed backwards from the final fee.
create or replace function public.prepare_invoice(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_invoice public.invoices;
  v_customer public.customers;
  v_email text;
  v_method text;
  v_item record;
  v_tax record;
  v_buyer jsonb;
  v_totals record;
  v_iva numeric := private.setting_integer('iva_rate_pct', 5)::numeric / 100;
  v_fee_base bigint;
begin
  select * into v_invoice from public.invoices where order_id = p_order_id;

  if v_invoice.id is null then
    select * into v_order from public.orders where id = p_order_id for update;
    if v_order.id is null or v_order.status not in ('paid', 'preparing', 'out_for_delivery', 'delivered')
       or v_order.needs_refund then
      raise exception 'invoice_order_not_invoiceable' using errcode = '22023';
    end if;

    select * into v_customer from public.customers where id = v_order.customer_id;
    select email into v_email from auth.users where id = v_order.customer_id;

    -- Buyer (D-044, PROJECT ASSUMPTIONS): wholesale with NIT; everybody else
    -- as "consumidor final" with their email.
    if v_customer.customer_type = 'wholesale' and v_customer.document_type = 'nit' then
      v_buyer := jsonb_build_object(
        'kind', 'company',
        'nit', v_customer.document_number,
        'company', coalesce(v_customer.business_name, v_customer.full_name),
        'email', v_email,
        'phone', v_customer.phone
      );
    else
      v_buyer := jsonb_build_object(
        'kind', 'final_consumer',
        'names', 'Consumidor final',
        'email', v_email
      );
    end if;

    select coalesce(a.payment_method_type, 'UNKNOWN') into v_method
    from public.payment_attempts a
    where a.order_id = p_order_id and a.status = 'approved'
    order by a.finalized_at desc limit 1;

    insert into public.invoices (
      order_id, reference_code, customer, payment_method_code,
      total_cop, iva_cop, participation_cop, exploitation_cop, base_cop
    ) values (
      p_order_id,
      'INV-' || upper(replace(p_order_id::text, '-', '')),
      v_buyer,
      coalesce(v_method, 'UNKNOWN'),
      v_order.total_cop, 0, 0, 0, v_order.total_cop
    )
    returning * into v_invoice;

    for v_item in
      select oi.*, oi.base_units as units from public.order_items oi where oi.order_id = p_order_id
    loop
      select * into v_tax from private.tax_breakdown(v_item.product_id, v_item.units, v_item.line_total_cop);
      insert into public.invoice_lines (
        invoice_id, product_id, sku, name, quantity_units, final_cop,
        base_cop, specific_cop, ad_valorem_cop, exploitation_cop, iva_cop
      ) values (
        v_invoice.id, v_item.product_id, v_item.sku, v_item.product_name, v_item.units,
        v_item.line_total_cop, v_tax.base_cop, v_tax.specific_cop, v_tax.ad_valorem_cop,
        v_tax.exploitation_cop, v_tax.iva_cop
      );
    end loop;

    if v_order.delivery_fee_cop > 0 then
      v_fee_base := round(v_order.delivery_fee_cop / (1 + v_iva));
      insert into public.invoice_lines (
        invoice_id, product_id, line_kind, sku, name, quantity_units, final_cop,
        base_cop, specific_cop, ad_valorem_cop, exploitation_cop, iva_cop
      ) values (
        v_invoice.id, null, 'delivery', 'DOMICILIO', 'Servicio de domicilio', 1,
        v_order.delivery_fee_cop, v_fee_base, 0, 0, 0, v_order.delivery_fee_cop - v_fee_base
      );
    end if;

    select sum(base_cop) b, sum(specific_cop + ad_valorem_cop) p, sum(exploitation_cop) e, sum(iva_cop) i
    into v_totals from public.invoice_lines where invoice_id = v_invoice.id;

    update public.invoices
    set base_cop = v_totals.b, participation_cop = v_totals.p,
        exploitation_cop = v_totals.e, iva_cop = v_totals.i
    where id = v_invoice.id
    returning * into v_invoice;
  end if;

  return to_jsonb(v_invoice) || jsonb_build_object(
    'lines', (select jsonb_agg(to_jsonb(l) order by l.line_kind desc, l.sku) from public.invoice_lines l where l.invoice_id = v_invoice.id)
  );
end;
$$;
