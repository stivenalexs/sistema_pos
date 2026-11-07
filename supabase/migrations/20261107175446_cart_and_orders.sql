-- Cart and web orders up to awaiting_payment (plan step 11, D-039).
--
-- - One cart per customer, stored in the database. It holds only product and
--   quantity; prices are always computed by quote_items() when shown.
-- - place_order() quotes the cart, creates the order and its items (price
--   snapshot), reserves the stock and empties the cart in ONE transaction.
--   It also records the action as already finished, so the tracking_id is
--   actions.id as agents.md requires, with the three anti-duplicate layers:
--   locked button, client idempotency_key and UNIQUE in the database.
-- - Unpaid orders keep their stock reserved 30 minutes (D-023) and are
--   cancelled after 24 hours (D-039).
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Types and settings
-- ---------------------------------------------------------------------------

create type public.order_status as enum (
  'draft', 'awaiting_payment', 'paid', 'preparing',
  'out_for_delivery', 'delivered', 'cancelled', 'refunded'
);
create type public.order_channel as enum ('web', 'pos');
create type public.fulfillment_method as enum ('pickup', 'delivery');

insert into public.app_settings (key, value) values
  ('order_payment_window_hours', '24'::jsonb);   -- D-039

-- ---------------------------------------------------------------------------
-- Cart
-- ---------------------------------------------------------------------------

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carts_customer_key unique (customer_id)
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  -- In the customer's sale unit (units or boxes), as shown in the catalog.
  quantity integer not null check (quantity between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_items_cart_product_key unique (cart_id, product_id)
);

create index cart_items_cart_idx on public.cart_items (cart_id);

create trigger set_updated_at before update on public.carts
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.cart_items
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Required for web orders (D-032); optional for POS sales (D-033).
  customer_id uuid references public.customers (id) on delete restrict,
  channel public.order_channel not null,
  status public.order_status not null default 'awaiting_payment',
  fulfillment public.fulfillment_method not null,
  sale_unit text not null check (sale_unit in ('unit', 'box')),
  subtotal_cop bigint not null check (subtotal_cop > 0),
  -- Computed by the delivery module (plan step 14). Pickup is free.
  delivery_fee_cop bigint not null default 0 check (delivery_fee_cop >= 0),
  total_cop bigint not null,
  total_boxes integer not null default 0 check (total_boxes >= 0),
  total_base_units integer not null check (total_base_units > 0),
  idempotency_key uuid not null,
  -- Until when the stock stays reserved (reservation expiry).
  payment_deadline timestamptz,
  -- Unpaid orders are cancelled after this moment.
  cancel_after timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_idempotency_key_key unique (idempotency_key),
  constraint orders_web_customer_check check (channel <> 'web' or customer_id is not null),
  constraint orders_total_check check (total_cop = subtotal_cop + delivery_fee_cop),
  constraint orders_cancelled_check check ((status = 'cancelled') = (cancelled_at is not null))
);

create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_unpaid_idx on public.orders (cancel_after) where status = 'awaiting_payment';

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  -- Snapshot at order time: later catalog or price changes do not alter it.
  sku text not null,
  product_name text not null,
  sale_unit text not null check (sale_unit in ('unit', 'box')),
  units_per_box integer not null check (units_per_box > 0),
  quantity integer not null check (quantity > 0),
  unit_price_cop bigint not null check (unit_price_cop > 0),
  line_total_cop bigint not null,
  base_units integer not null check (base_units > 0),
  created_at timestamptz not null default now(),
  constraint order_items_order_product_key unique (order_id, product_id),
  constraint order_items_total_check check (line_total_cop = unit_price_cop * quantity)
);

-- Status history, written by a trigger (traceability).
create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_id uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, created_at);

create trigger set_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

create trigger order_items_insert_only
  before update or delete on public.order_items
  for each row execute function private.forbid_change();
create trigger order_events_insert_only
  before update or delete on public.order_events
  for each row execute function private.forbid_change();

create function private.log_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_events (order_id, from_status, to_status, actor_id, reason)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      auth.uid(),
      case when new.status = 'cancelled' then new.cancel_reason end
    );
  end if;
  return null;
end;
$$;

create trigger log_order_status
  after insert or update of status on public.orders
  for each row execute function private.log_order_status();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on public.carts, public.cart_items, public.orders, public.order_items, public.order_events
  from anon;
revoke insert, update, delete on public.carts, public.cart_items, public.orders, public.order_items, public.order_events
  from authenticated;

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;

create policy "carts: read own"
  on public.carts for select to authenticated
  using (customer_id = (select auth.uid()));

create policy "cart_items: read own"
  on public.cart_items for select to authenticated
  using (exists (
    select 1 from public.carts c
    where c.id = cart_id and c.customer_id = (select auth.uid())
  ));

create policy "orders: read own"
  on public.orders for select to authenticated
  using (customer_id = (select auth.uid()));

create policy "orders: staff reads all"
  on public.orders for select to authenticated
  using ((select private.has_staff_role(array['admin', 'cashier', 'warehouse'])));

create policy "order_items: read with the order"
  on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy "order_events: read with the order"
  on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- ---------------------------------------------------------------------------
-- Reservation internals (no role check; callers check permissions)
-- ---------------------------------------------------------------------------

-- Same logic as public.reserve_stock, callable from other SECURITY DEFINER
-- functions that already validated the caller.
create function private.reserve_units(
  p_reference text,
  p_items jsonb,
  p_ttl_minutes integer,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_units integer;
  v_stock public.product_stock;
  v_safety integer;
  v_reservation_id uuid;
begin
  if length(trim(coalesce(p_reference, ''))) = 0 then perform private.inventory_error('missing_reference'); end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    perform private.inventory_error('invalid_items');
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items) order by value ->> 'product_id'
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_units := (v_item ->> 'units')::integer;
    if v_units is null or v_units <= 0 then perform private.inventory_error('invalid_units'); end if;

    v_stock := private.lock_stock(v_product_id);
    select web_safety_stock into v_safety from public.products where id = v_product_id;
    if v_stock.on_hand - v_stock.reserved - v_safety < v_units then
      raise exception 'inventory_insufficient_stock'
        using errcode = '22023', detail = v_product_id::text;
    end if;

    insert into public.stock_reservations (product_id, units, reference, expires_at, created_by)
    values (v_product_id, v_units, trim(p_reference), now() + make_interval(mins => p_ttl_minutes), p_created_by)
    returning id into v_reservation_id;

    insert into public.inventory_movements
      (product_id, movement_type, units, reference, reservation_id, created_by)
    values
      (v_product_id, 'reservation', v_units, trim(p_reference), v_reservation_id, p_created_by);
  end loop;
end;
$$;

revoke all on function private.reserve_units(text, jsonb, integer, uuid) from public;

create function private.setting_integer(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (value #>> '{}')::integer from public.app_settings where key = p_key),
    p_default
  );
$$;

revoke all on function private.setting_integer(text, integer) from public;

-- ---------------------------------------------------------------------------
-- Cart operations (signed-in customers)
-- ---------------------------------------------------------------------------

-- Sets the quantity of a product in the caller's cart; 0 removes it.
create function public.set_cart_item(p_product_id uuid, p_quantity integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cart_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.customers where id = v_uid) then
    raise exception 'cart_requires_customer' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 10000 then
    raise exception 'cart_invalid_quantity' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and is_active) then
    raise exception 'cart_unknown_product' using errcode = '22023';
  end if;

  insert into public.carts (customer_id) values (v_uid)
  on conflict (customer_id) do update set updated_at = now()
  returning id into v_cart_id;

  if p_quantity = 0 then
    delete from public.cart_items where cart_id = v_cart_id and product_id = p_product_id;
    return;
  end if;

  if (select count(*) from public.cart_items where cart_id = v_cart_id and product_id <> p_product_id) >= 100 then
    raise exception 'cart_too_many_items' using errcode = '22023';
  end if;

  insert into public.cart_items (cart_id, product_id, quantity)
  values (v_cart_id, p_product_id, p_quantity)
  on conflict (cart_id, product_id) do update set quantity = excluded.quantity;
end;
$$;

-- The caller's cart as quote_items input.
create function public.get_cart_items()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('product_id', ci.product_id, 'quantity', ci.quantity)
              order by ci.created_at),
    '[]'::jsonb
  )
  from public.cart_items ci
  join public.carts c on c.id = ci.cart_id
  where c.customer_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Place and cancel orders
-- ---------------------------------------------------------------------------

-- Privileged part of place_order. Called only after the quote (computed with
-- the caller's own permissions) is valid.
create function private.create_web_order(
  p_customer_id uuid,
  p_idempotency_key uuid,
  p_fulfillment public.fulfillment_method,
  p_quote jsonb
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
begin
  -- Layer 3 of idempotency: the action key is UNIQUE. A concurrent second
  -- call waits here for the first one and then returns its result.
  insert into public.actions (idempotency_key, type, user_id, status, payload, attempts, started_at)
  values (p_idempotency_key, 'place_order', p_customer_id, 'processing',
          jsonb_build_object('fulfillment', p_fulfillment), 1, now())
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

  if p_fulfillment <> 'pickup' then
    -- Delivery arrives with plan step 14 (fee by distance, P-010).
    raise exception 'order_delivery_not_available' using errcode = '22023';
  end if;

  insert into public.orders (
    customer_id, channel, status, fulfillment, sale_unit,
    subtotal_cop, delivery_fee_cop, total_cop, total_boxes, total_base_units,
    idempotency_key, payment_deadline, cancel_after
  ) values (
    p_customer_id, 'web', 'awaiting_payment', p_fulfillment, p_quote ->> 'sale_unit',
    (p_quote ->> 'total_cop')::bigint, 0, (p_quote ->> 'total_cop')::bigint,
    (p_quote ->> 'total_boxes')::integer, (p_quote ->> 'total_base_units')::integer,
    p_idempotency_key, now() + make_interval(mins => v_ttl), now() + make_interval(hours => v_window)
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

revoke all on function private.create_web_order(uuid, uuid, public.fulfillment_method, jsonb) from public;
grant execute on function private.create_web_order(uuid, uuid, public.fulfillment_method, jsonb) to authenticated;

-- Places a web order from the caller's cart.
-- SECURITY INVOKER: the quote runs with the customer's own permissions (RLS
-- decides prices and visible products); only the order creation is privileged.
-- Returns {"ok": true, "created", "tracking_id", "order_id"} or
--         {"ok": false, "error": "cart_empty"|"quote_failed"|"insufficient_stock", ...}
create function public.place_order(
  p_idempotency_key uuid,
  p_fulfillment public.fulfillment_method default 'pickup'
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
    return private.create_web_order(v_uid, p_idempotency_key, p_fulfillment, v_quote);
  exception when sqlstate '22023' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm = 'inventory_insufficient_stock' then
      return jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'product_id', v_detail);
    end if;
    raise;
  end;
end;
$$;

-- Cancels an unpaid order and releases its reservation.
create function private.cancel_web_order(p_order_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.orders
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  where id = p_order_id and status = 'awaiting_payment';
  if not found then
    return false;
  end if;
  perform private.release_reservations(p_order_id::text, 'released', false);
  return true;
end;
$$;

revoke all on function private.cancel_web_order(uuid, text) from public;
grant execute on function private.cancel_web_order(uuid, text) to authenticated;

-- The customer cancels their own unpaid order.
create function public.cancel_order(p_order_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- RLS: only the customer's own orders are visible.
  if not exists (
    select 1 from public.orders
    where id = p_order_id and customer_id = auth.uid() and status = 'awaiting_payment'
  ) then
    raise exception 'order_not_cancellable' using errcode = '22023';
  end if;
  return private.cancel_web_order(p_order_id, 'cancelled_by_customer');
end;
$$;

-- Called by pg_cron: cancels orders unpaid after the payment window.
create function public.cancel_abandoned_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_count integer := 0;
begin
  for v_order_id in
    select id from public.orders
    where status = 'awaiting_payment' and cancel_after <= now()
    for update skip locked
  loop
    if private.cancel_web_order(v_order_id, 'payment_window_expired') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function
  public.set_cart_item(uuid, integer),
  public.get_cart_items(),
  public.place_order(uuid, public.fulfillment_method),
  public.cancel_order(uuid),
  public.cancel_abandoned_orders()
from public, anon, authenticated;

grant execute on function
  public.set_cart_item(uuid, integer),
  public.get_cart_items(),
  public.place_order(uuid, public.fulfillment_method),
  public.cancel_order(uuid)
to authenticated;

grant execute on function public.cancel_abandoned_orders() to service_role;

select cron.schedule(
  'cancel-abandoned-orders',
  '*/5 * * * *',
  'select public.cancel_abandoned_orders()'
);
