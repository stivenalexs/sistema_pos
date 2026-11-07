-- Inventory: insert-only movements ledger, atomic stock balance and web
-- reservations with expiry (plan step 10, D-038).
--
-- Golden rule: stock changes ONLY by inserting into inventory_movements.
-- A trigger applies each movement to product_stock in the same transaction,
-- and CHECK constraints make every exit conditional: a movement that would
-- leave negative stock, or take units reserved for a pending web order, fails.
--
-- One stock per product, shared by the POS and the web (D-009, D-038).
-- Quantities are always in base units; a box is units_per_box units.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.app_settings
  for each row execute function private.set_updated_at();

insert into public.app_settings (key, value) values
  ('reservation_ttl_minutes', '30'::jsonb);   -- D-023

revoke all on public.app_settings from anon;
revoke insert, update, delete on public.app_settings from authenticated;
alter table public.app_settings enable row level security;

create policy "app_settings: staff reads"
  on public.app_settings for select
  to authenticated
  using ((select private.has_staff_role(array['admin', 'cashier', 'warehouse', 'courier'])));

create policy "app_settings: admin updates"
  on public.app_settings for update
  to authenticated
  using ((select private.has_staff_role(array['admin'])))
  with check ((select private.has_staff_role(array['admin'])));

grant update (value) on public.app_settings to authenticated;

alter table public.products
  add column web_safety_stock integer not null default 0 check (web_safety_stock >= 0),
  add column low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0);

-- ---------------------------------------------------------------------------
-- Ledger, balance and reservations
-- ---------------------------------------------------------------------------

create type public.inventory_movement_type as enum (
  'purchase_in', 'web_sale', 'pos_sale', 'adjustment', 'waste',
  'return_in', 'reservation', 'reservation_release'
);

create type public.reservation_status as enum ('active', 'consumed', 'released', 'expired');

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  units integer not null check (units > 0),
  -- What the units are reserved for, e.g. the order id (plan step 11).
  reference text not null check (length(trim(reference)) > 0),
  status public.reservation_status not null default 'active',
  expires_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active reservation per product and reference.
create unique index stock_reservations_one_active
  on public.stock_reservations (reference, product_id)
  where status = 'active';
create index stock_reservations_expiry_idx
  on public.stock_reservations (expires_at)
  where status = 'active';

create trigger set_updated_at before update on public.stock_reservations
  for each row execute function private.set_updated_at();

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  movement_type public.inventory_movement_type not null,
  -- Signed, in base units: positive enters, negative leaves.
  units integer not null check (units <> 0),
  reason text check (length(trim(reason)) > 0),
  -- Purchase invoice, order id, POS sale id, count sheet...
  reference text check (length(trim(reference)) > 0),
  reservation_id uuid references public.stock_reservations (id) on delete restrict,
  created_by uuid references auth.users (id) on delete set null,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  constraint inventory_movements_idempotency_key_key unique (idempotency_key),
  constraint inventory_movements_sign_check check (
    case movement_type
      when 'purchase_in' then units > 0
      when 'return_in' then units > 0
      when 'reservation' then units > 0
      when 'web_sale' then units < 0
      when 'pos_sale' then units < 0
      when 'waste' then units < 0
      when 'reservation_release' then units < 0
      when 'adjustment' then true
    end
  ),
  -- Manual movements need a reason; entries need their document.
  constraint inventory_movements_requires_reason check (
    movement_type not in ('adjustment', 'waste') or reason is not null
  ),
  constraint inventory_movements_requires_reference check (
    movement_type <> 'purchase_in' or reference is not null
  )
);

create index inventory_movements_product_idx
  on public.inventory_movements (product_id, created_at desc);
create index inventory_movements_reference_idx
  on public.inventory_movements (reference)
  where reference is not null;

-- Derived balance. Written ONLY by the trigger below.
create table public.product_stock (
  product_id uuid primary key references public.products (id) on delete restrict,
  on_hand integer not null default 0,
  reserved integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint product_stock_on_hand_check check (on_hand >= 0),
  constraint product_stock_reserved_check check (reserved >= 0),
  -- Available = on_hand - reserved can never be negative: no sale (POS or
  -- web) can take units reserved for a pending web order.
  constraint product_stock_available_check check (reserved <= on_hand)
);

-- Movements and reservation history are insert-only.
create trigger inventory_movements_insert_only
  before update or delete on public.inventory_movements
  for each row execute function private.forbid_change();

-- Applies a movement to the balance in the same transaction.
create function private.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_stock (product_id)
  values (new.product_id)
  on conflict (product_id) do nothing;

  if new.movement_type in ('reservation', 'reservation_release') then
    update public.product_stock
    set reserved = reserved + new.units, updated_at = now()
    where product_id = new.product_id;
  else
    update public.product_stock
    set on_hand = on_hand + new.units, updated_at = now()
    where product_id = new.product_id;
  end if;
  return null;
end;
$$;

create trigger apply_inventory_movement
  after insert on public.inventory_movements
  for each row execute function private.apply_inventory_movement();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on public.inventory_movements, public.product_stock, public.stock_reservations from anon;
revoke insert, update, delete on public.inventory_movements, public.product_stock, public.stock_reservations
  from authenticated;

alter table public.inventory_movements enable row level security;
alter table public.product_stock enable row level security;
alter table public.stock_reservations enable row level security;

create policy "inventory_movements: staff reads"
  on public.inventory_movements for select
  to authenticated
  using ((select private.has_staff_role(array['admin', 'warehouse', 'cashier'])));

create policy "product_stock: staff reads"
  on public.product_stock for select
  to authenticated
  using ((select private.has_staff_role(array['admin', 'warehouse', 'cashier'])));

create policy "stock_reservations: staff reads"
  on public.stock_reservations for select
  to authenticated
  using ((select private.has_staff_role(array['admin', 'warehouse'])));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.is_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

-- Raises unless the caller is the server or has one of the staff roles.
create function private.require_staff(p_roles text[])
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not (private.is_service_role() or private.has_staff_role(p_roles)) then
    raise exception 'inventory_forbidden' using errcode = '42501';
  end if;
end;
$$;

create function private.inventory_error(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'inventory_%', p_code using errcode = '22023';
end;
$$;

-- Locks the product's balance row (creating it if needed) and returns it.
create function private.lock_stock(p_product_id uuid)
returns public.product_stock
language plpgsql
set search_path = ''
as $$
declare
  v_row public.product_stock;
begin
  if not exists (select 1 from public.products where id = p_product_id) then
    perform private.inventory_error('unknown_product');
  end if;
  insert into public.product_stock (product_id) values (p_product_id)
  on conflict (product_id) do nothing;
  select * into v_row from public.product_stock
  where product_id = p_product_id for update;
  return v_row;
end;
$$;

-- Existing movement for an idempotency key, or null.
create function private.movement_by_key(p_key uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from public.inventory_movements where idempotency_key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- Staff operations (admin and warehouse; D-038)
-- ---------------------------------------------------------------------------

-- Goods received. Reference = purchase invoice or delivery note.
create function public.record_stock_entry(
  p_product_id uuid,
  p_units integer,
  p_reference text,
  p_idempotency_key uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_staff(array['admin', 'warehouse']);
  v_id := private.movement_by_key(p_idempotency_key);
  if v_id is not null then return v_id; end if;
  if p_units is null or p_units <= 0 then perform private.inventory_error('invalid_units'); end if;
  if length(trim(coalesce(p_reference, ''))) = 0 then perform private.inventory_error('missing_reference'); end if;

  perform private.lock_stock(p_product_id);
  insert into public.inventory_movements
    (product_id, movement_type, units, reference, reason, created_by, idempotency_key)
  values
    (p_product_id, 'purchase_in', p_units, trim(p_reference), nullif(trim(p_reason), ''), auth.uid(), p_idempotency_key)
  returning id into v_id;
  return v_id;
end;
$$;

-- Cycle count: records the difference between the physical count and the
-- stock on hand as an adjustment. Returns null when there is no difference.
create function public.record_count(
  p_product_id uuid,
  p_counted_units integer,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_stock public.product_stock;
  v_diff integer;
begin
  perform private.require_staff(array['admin', 'warehouse']);
  v_id := private.movement_by_key(p_idempotency_key);
  if v_id is not null then return v_id; end if;
  if p_counted_units is null or p_counted_units < 0 then perform private.inventory_error('invalid_units'); end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then perform private.inventory_error('missing_reason'); end if;

  v_stock := private.lock_stock(p_product_id);
  if p_counted_units < v_stock.reserved then
    -- Units reserved for pending web orders are missing: needs a decision.
    perform private.inventory_error('count_below_reserved');
  end if;
  v_diff := p_counted_units - v_stock.on_hand;
  if v_diff = 0 then return null; end if;

  insert into public.inventory_movements
    (product_id, movement_type, units, reason, created_by, idempotency_key)
  values
    (p_product_id, 'adjustment', v_diff, trim(p_reason), auth.uid(), p_idempotency_key)
  returning id into v_id;
  return v_id;
end;
$$;

-- Waste or breakage.
create function public.record_waste(
  p_product_id uuid,
  p_units integer,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_stock public.product_stock;
begin
  perform private.require_staff(array['admin', 'warehouse']);
  v_id := private.movement_by_key(p_idempotency_key);
  if v_id is not null then return v_id; end if;
  if p_units is null or p_units <= 0 then perform private.inventory_error('invalid_units'); end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then perform private.inventory_error('missing_reason'); end if;

  v_stock := private.lock_stock(p_product_id);
  if v_stock.on_hand - v_stock.reserved < p_units then
    perform private.inventory_error('insufficient_stock');
  end if;
  insert into public.inventory_movements
    (product_id, movement_type, units, reason, created_by, idempotency_key)
  values
    (p_product_id, 'waste', -p_units, trim(p_reason), auth.uid(), p_idempotency_key)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Web reservations (server only: orders and payments, plan steps 11 and 12)
-- ---------------------------------------------------------------------------

-- Units the web can still sell: available minus the product's safety stock.
create function private.web_available_units(p_product_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce(s.on_hand - s.reserved, 0) - p.web_safety_stock,
    0
  )
  from public.products p
  left join public.product_stock s on s.product_id = p.id
  where p.id = p_product_id;
$$;

-- Reserves every item or none. Items: [{"product_id": uuid, "units": int}]
-- in base units. Returns the reservation ids.
create function public.reserve_stock(
  p_reference text,
  p_items jsonb,
  p_ttl_minutes integer default null
)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_units integer;
  v_ttl integer;
  v_stock public.product_stock;
  v_safety integer;
  v_reservation_id uuid;
begin
  perform private.require_staff(array['admin']);
  if length(trim(coalesce(p_reference, ''))) = 0 then perform private.inventory_error('missing_reference'); end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    perform private.inventory_error('invalid_items');
  end if;

  v_ttl := coalesce(
    p_ttl_minutes,
    (select (value #>> '{}')::integer from public.app_settings where key = 'reservation_ttl_minutes'),
    30
  );

  -- Lock in a stable order (by product id) to avoid deadlocks between two
  -- reservations that share products.
  for v_item in
    select value from jsonb_array_elements(p_items) order by value ->> 'product_id'
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_units := (v_item ->> 'units')::integer;
    if v_units is null or v_units <= 0 then perform private.inventory_error('invalid_units'); end if;

    v_stock := private.lock_stock(v_product_id);
    select web_safety_stock into v_safety from public.products where id = v_product_id;
    if v_stock.on_hand - v_stock.reserved - v_safety < v_units then
      -- Aborts the whole transaction: nothing stays reserved.
      raise exception 'inventory_insufficient_stock'
        using errcode = '22023', detail = v_product_id::text;
    end if;

    insert into public.stock_reservations (product_id, units, reference, expires_at, created_by)
    values (v_product_id, v_units, trim(p_reference), now() + make_interval(mins => v_ttl), auth.uid())
    returning id into v_reservation_id;

    insert into public.inventory_movements
      (product_id, movement_type, units, reference, reservation_id, created_by)
    values
      (v_product_id, 'reservation', v_units, trim(p_reference), v_reservation_id, auth.uid());

    return next v_reservation_id;
  end loop;
end;
$$;

-- Releases the active reservations of a reference (order cancelled).
-- p_status: 'released' (cancelled) or 'expired' (used by the cron job).
create function private.release_reservations(
  p_reference text,
  p_status public.reservation_status,
  p_only_expired boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.stock_reservations;
  v_count integer := 0;
begin
  for v_res in
    select * from public.stock_reservations
    where status = 'active'
      and (p_reference is null or reference = p_reference)
      and (not p_only_expired or expires_at <= now())
    order by product_id
    for update skip locked
  loop
    perform private.lock_stock(v_res.product_id);
    insert into public.inventory_movements
      (product_id, movement_type, units, reference, reservation_id)
    values
      (v_res.product_id, 'reservation_release', -v_res.units, v_res.reference, v_res.id);
    update public.stock_reservations set status = p_status where id = v_res.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function public.release_reservation(p_reference text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin']);
  return private.release_reservations(p_reference, 'released', false);
end;
$$;

-- Called every minute by pg_cron.
create function public.release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.release_reservations(null, 'expired', true);
end;
$$;

-- Turns the reservations of a paid order into a web sale. If a reservation
-- already expired, it still sells when there is stock available; otherwise
-- it fails with inventory_insufficient_stock and the order must be refunded.
-- p_items: [{"product_id": uuid, "units": int}] = what the order bought.
create function public.consume_reservation(
  p_reference text,
  p_items jsonb,
  p_idempotency_key uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_units integer;
  v_res public.stock_reservations;
  v_stock public.product_stock;
  v_count integer := 0;
begin
  perform private.require_staff(array['admin']);
  -- Already consumed with this key: do nothing (webhook retries).
  if exists (
    select 1 from public.inventory_movements
    where reference = trim(p_reference) and movement_type = 'web_sale'
      and idempotency_key = p_idempotency_key
  ) then
    return 0;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items) order by value ->> 'product_id'
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_units := (v_item ->> 'units')::integer;
    v_stock := private.lock_stock(v_product_id);

    select * into v_res from public.stock_reservations
    where reference = trim(p_reference) and product_id = v_product_id and status = 'active'
    for update;

    if v_res.id is not null then
      -- Release first, then sell: the units stop being reserved and leave.
      insert into public.inventory_movements
        (product_id, movement_type, units, reference, reservation_id)
      values (v_product_id, 'reservation_release', -v_res.units, v_res.reference, v_res.id);
      update public.stock_reservations set status = 'consumed' where id = v_res.id;
      v_stock := private.lock_stock(v_product_id);
    end if;

    if v_stock.on_hand - v_stock.reserved < v_units then
      raise exception 'inventory_insufficient_stock'
        using errcode = '22023', detail = v_product_id::text;
    end if;

    insert into public.inventory_movements
      (product_id, movement_type, units, reference, reservation_id, idempotency_key)
    values (
      v_product_id, 'web_sale', -v_units, trim(p_reference), v_res.id,
      -- The key marks the first line only; the rest of the lines are covered
      -- because the whole function runs in one transaction.
      case when v_count = 0 then p_idempotency_key end
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read helpers
-- ---------------------------------------------------------------------------

-- Web availability of the products the caller can see, in base units and in
-- the caller's sale unit. SECURITY INVOKER: get_catalog() keeps RLS, so an
-- imported product's stock is never shown to a retail customer.
create function public.get_web_availability()
returns table (product_id uuid, available_units integer, available_sale_units integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.product_id,
    private.web_available_units(c.product_id),
    case when c.sale_unit = 'box'
      then private.web_available_units(c.product_id) / c.units_per_box
      else private.web_available_units(c.product_id)
    end
  from public.get_catalog() c;
$$;

-- Products whose balance does not match the sum of their movements.
-- Must always return zero rows.
create function public.reconcile_stock()
returns table (product_id uuid, on_hand integer, ledger_on_hand bigint, reserved integer, ledger_reserved bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.product_id, s.on_hand, coalesce(m.on_hand, 0), s.reserved, coalesce(m.reserved, 0)
  from public.product_stock s
  left join (
    select product_id,
      sum(units) filter (where movement_type not in ('reservation', 'reservation_release')) as on_hand,
      sum(units) filter (where movement_type in ('reservation', 'reservation_release')) as reserved
    from public.inventory_movements group by product_id
  ) m on m.product_id = s.product_id
  where s.on_hand <> coalesce(m.on_hand, 0) or s.reserved <> coalesce(m.reserved, 0);
$$;

-- Products at or below their low-stock threshold (admin panel, step 17).
create function public.low_stock_products()
returns table (product_id uuid, sku text, name text, on_hand integer, reserved integer, threshold integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin', 'warehouse']);
  return query
    select p.id, p.sku, p.name, coalesce(s.on_hand, 0), coalesce(s.reserved, 0), p.low_stock_threshold
    from public.products p
    left join public.product_stock s on s.product_id = p.id
    where p.is_active and coalesce(s.on_hand, 0) - coalesce(s.reserved, 0) <= p.low_stock_threshold
    order by p.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.apply_inventory_movement(),
  private.is_service_role(),
  private.require_staff(text[]),
  private.inventory_error(text),
  private.lock_stock(uuid),
  private.movement_by_key(uuid),
  private.release_reservations(text, public.reservation_status, boolean)
from public;

revoke all on function private.web_available_units(uuid) from public;
grant execute on function private.web_available_units(uuid) to anon, authenticated, service_role;

revoke all on function
  public.record_stock_entry(uuid, integer, text, uuid, text),
  public.record_count(uuid, integer, text, uuid),
  public.record_waste(uuid, integer, text, uuid),
  public.reserve_stock(text, jsonb, integer),
  public.release_reservation(text),
  public.release_expired_reservations(),
  public.consume_reservation(text, jsonb, uuid),
  public.reconcile_stock(),
  public.low_stock_products(),
  public.get_web_availability()
from public, anon, authenticated;

-- Staff operations check the role inside; signed-in users may call them.
grant execute on function
  public.record_stock_entry(uuid, integer, text, uuid, text),
  public.record_count(uuid, integer, text, uuid),
  public.record_waste(uuid, integer, text, uuid),
  public.low_stock_products()
to authenticated, service_role;

-- Reservations and sales: server only.
grant execute on function
  public.reserve_stock(text, jsonb, integer),
  public.release_reservation(text),
  public.release_expired_reservations(),
  public.consume_reservation(text, jsonb, uuid),
  public.reconcile_stock()
to service_role;

grant execute on function public.get_web_availability() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Expired reservations job
-- ---------------------------------------------------------------------------

select cron.schedule(
  'release-expired-reservations',
  '* * * * *',
  'select public.release_expired_reservations()'
);
