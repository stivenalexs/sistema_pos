-- Configurable sales blocks by municipality, date and time (plan step 15,
-- D-051). Real rules (dry law, local schedules) must be validated with a
-- lawyer (P-006): this only gives the administrator the tool.
--
-- - Two kinds of rule in sales_blocks: a date range (e.g. dry law for an
--   election) and a weekly window in Bogotá time (e.g. 02:00 to 10:00 every
--   day; a window can cross midnight). A rule is global (zone_id null) or for
--   one municipality, and applies to the web, the POS or both.
-- - Municipality of a sale: the delivery address for home delivery; the
--   store's municipality (app_settings.store_zone_id, PROJECT ASSUMPTION:
--   Medellín) for pickup and the POS. Stored in orders.sale_zone_id.
-- - Enforced in the database: a BEFORE INSERT trigger on orders rejects any
--   order (web or POS) while a rule applies, and start_payment refuses to
--   start a new payment. A payment already started before the block is
--   respected. Carts are never emptied.
-- - Every change of a rule is logged (who and when) in sales_block_changes.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Store municipality
-- ---------------------------------------------------------------------------

-- PROJECT ASSUMPTION (D-051): the store is in Medellín, like store_location.
insert into public.app_settings (key, value)
select 'store_zone_id', to_jsonb(id::text) from public.delivery_zones where dane_code = '05001';

create function private.store_zone_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (value #>> '{}')::uuid from public.app_settings where key = 'store_zone_id'),
    (select id from public.delivery_zones where dane_code = '05001')
  );
$$;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

create type public.sales_block_kind as enum ('date_range', 'weekly');

create table public.sales_blocks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  kind public.sales_block_kind not null,
  -- Null: the whole department (every municipality).
  zone_id uuid references public.delivery_zones (id) on delete restrict,
  channels text[] not null default array['web', 'pos']
    check (cardinality(channels) between 1 and 2 and channels <@ array['web', 'pos']),
  -- date_range: the blocked period. weekly: optional validity of the rule.
  starts_at timestamptz,
  ends_at timestamptz,
  -- weekly: ISO days (1 = Monday ... 7 = Sunday) on which the window STARTS,
  -- and the window in Bogotá time. end_time < start_time crosses midnight.
  weekdays smallint[],
  start_time time,
  end_time time,
  -- Shown to the customer and the cashier.
  message text not null check (length(trim(message)) between 3 and 300),
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_blocks_range_check check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint sales_blocks_date_range_check check (
    kind <> 'date_range'
    or (starts_at is not null and ends_at is not null
        and weekdays is null and start_time is null and end_time is null)
  ),
  constraint sales_blocks_weekly_check check (
    kind <> 'weekly'
    or (weekdays is not null and cardinality(weekdays) between 1 and 7
        and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
        and start_time is not null and end_time is not null and start_time <> end_time)
  )
);

create index sales_blocks_active_idx on public.sales_blocks (zone_id) where is_active;

-- Change log (insert only).
create table public.sales_block_changes (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key: the history survives a deleted rule.
  block_id uuid not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  actor_id uuid references auth.users (id) on delete set null,
  old_row jsonb,
  new_row jsonb,
  created_at timestamptz not null default now()
);

create index sales_block_changes_block_idx on public.sales_block_changes (block_id, created_at);

create trigger sales_block_changes_insert_only before update or delete on public.sales_block_changes
  for each row execute function private.forbid_change();

-- Who created and who last changed a rule: always from the session.
create function private.stamp_sales_block()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger stamp_sales_block before insert or update on public.sales_blocks
  for each row execute function private.stamp_sales_block();

create function private.log_sales_block_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sales_block_changes (block_id, operation, actor_id, old_row, new_row)
  values (
    coalesce(new.id, old.id),
    lower(tg_op),
    auth.uid(),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end;
$$;

create trigger log_sales_block_change after insert or update or delete on public.sales_blocks
  for each row execute function private.log_sales_block_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- Only the administrator reads the tables directly. Customers, visitors and
-- the POS use get_sales_block(), which returns {block_id, name, message,
-- ends_at} and never the staff ids in created_by / updated_by.
-- REVOKE ALL also removes TRUNCATE, REFERENCES and TRIGGER: row-level
-- triggers and RLS do not stop a TRUNCATE.
revoke all on public.sales_blocks, public.sales_block_changes from anon, authenticated;
grant select, insert, update, delete on public.sales_blocks to authenticated;
grant select on public.sales_block_changes to authenticated;

alter table public.sales_blocks enable row level security;
alter table public.sales_block_changes enable row level security;

create policy "sales_blocks: admin reads"
  on public.sales_blocks for select to authenticated
  using ((select private.has_staff_role(array['admin'])));
create policy "sales_blocks: admin inserts"
  on public.sales_blocks for insert to authenticated
  with check ((select private.has_staff_role(array['admin'])));
create policy "sales_blocks: admin updates"
  on public.sales_blocks for update to authenticated
  using ((select private.has_staff_role(array['admin'])))
  with check ((select private.has_staff_role(array['admin'])));
create policy "sales_blocks: admin deletes"
  on public.sales_blocks for delete to authenticated
  using ((select private.has_staff_role(array['admin'])));

create policy "sales_block_changes: admin reads"
  on public.sales_block_changes for select to authenticated
  using ((select private.has_staff_role(array['admin'])));

-- ---------------------------------------------------------------------------
-- Evaluation (Bogotá time)
-- ---------------------------------------------------------------------------

-- When the current blocked period of a rule ends, or null if the rule does
-- not block at p_at.
create function private.sales_block_until(p_block public.sales_blocks, p_at timestamptz)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone 'America/Bogota';
  v_day integer := extract(isodow from v_local)::integer;
  v_prev integer := case when extract(isodow from v_local)::integer = 1 then 7
                         else extract(isodow from v_local)::integer - 1 end;
  v_time time := v_local::time;
  v_end_local timestamp;
  v_until timestamptz;
begin
  if p_block.starts_at is not null and p_at < p_block.starts_at then return null; end if;
  if p_block.ends_at is not null and p_at >= p_block.ends_at then return null; end if;

  if p_block.kind = 'date_range' then
    return p_block.ends_at;
  end if;

  if p_block.start_time < p_block.end_time then
    if v_day = any (p_block.weekdays) and v_time >= p_block.start_time and v_time < p_block.end_time then
      v_end_local := v_local::date + p_block.end_time;
    end if;
  else
    -- Crosses midnight: started today, or started yesterday and still on.
    if v_day = any (p_block.weekdays) and v_time >= p_block.start_time then
      v_end_local := (v_local::date + 1) + p_block.end_time;
    elsif v_prev = any (p_block.weekdays) and v_time < p_block.end_time then
      v_end_local := v_local::date + p_block.end_time;
    end if;
  end if;

  if v_end_local is null then return null; end if;
  v_until := v_end_local at time zone 'America/Bogota';
  return case when p_block.ends_at is not null and p_block.ends_at < v_until then p_block.ends_at else v_until end;
end;
$$;

-- The rule that blocks a sale on a channel in a municipality at a moment,
-- as {block_id, name, message, ends_at}, or null. With several, the one that
-- lasts longest (the honest "until when").
create function private.sales_block_at(p_channel text, p_zone_id uuid, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('block_id', b.id, 'name', b.name, 'message', b.message, 'ends_at', u.until)
  from public.sales_blocks b
  cross join lateral (select private.sales_block_until(b, p_at) as until) u
  where b.is_active
    and p_channel = any (b.channels)
    and (b.zone_id is null or b.zone_id = p_zone_id)
    and u.until is not null
  order by u.until desc
  limit 1;
$$;

-- For notices (catalog, cart, order) and the POS (step 16): the block that
-- applies now. Without a municipality, the store's.
create function public.get_sales_block(p_channel text default 'web', p_zone_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.sales_block_at(
    case when p_channel in ('web', 'pos') then p_channel else 'web' end,
    coalesce(p_zone_id, private.store_zone_id()),
    now()
  );
$$;

-- ---------------------------------------------------------------------------
-- Orders: municipality of the sale and enforcement
-- ---------------------------------------------------------------------------

alter table public.orders
  add column sale_zone_id uuid references public.delivery_zones (id) on delete restrict;

update public.orders o
set sale_zone_id = coalesce(
  (select z.id from public.delivery_zones z where z.dane_code = o.delivery_address ->> 'dane_code'),
  private.store_zone_id()
);

-- Sets the municipality (from the address snapshot, never editable later) and
-- rejects the order while a rule applies, for the web and the POS alike.
create function private.enforce_sales_blocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block jsonb;
begin
  new.sale_zone_id := coalesce(
    (select z.id from public.delivery_zones z
     where new.fulfillment = 'delivery' and z.dane_code = new.delivery_address ->> 'dane_code'),
    private.store_zone_id()
  );
  v_block := private.sales_block_at(new.channel::text, new.sale_zone_id, now());
  if v_block is not null then
    raise exception 'sales_blocked' using errcode = '22023', detail = v_block::text;
  end if;
  return new;
end;
$$;

create trigger enforce_sales_blocks before insert on public.orders
  for each row execute function private.enforce_sales_blocks();

-- place_order: same as step 14, plus the sales_blocked answer.
create or replace function public.place_order(
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
    if sqlerrm = 'sales_blocked' then
      -- Nothing was created and the cart stays as it was.
      return jsonb_build_object('ok', false, 'error', 'sales_blocked', 'block', v_detail::jsonb);
    end if;
    raise;
  end;
end;
$$;

-- start_payment: same as step 12, but no NEW payment starts while a rule
-- applies to the order's municipality. A retry of a payment already started
-- (same key) still returns it.
create or replace function public.start_payment(p_order_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_detail text;
  v_block jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.orders where id = p_order_id and customer_id = v_uid
  ) then
    raise exception 'payment_order_not_found' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'payment_missing_idempotency_key' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.actions
    where idempotency_key = p_idempotency_key and user_id = v_uid and type = 'start_payment'
  ) then
    v_block := private.sales_block_at(
      'web',
      coalesce((select sale_zone_id from public.orders where id = p_order_id), private.store_zone_id()),
      now()
    );
    if v_block is not null then
      return jsonb_build_object('ok', false, 'error', 'sales_blocked', 'block', v_block);
    end if;
  end if;

  begin
    return private.create_payment_attempt(p_order_id, v_uid, p_idempotency_key);
  exception when sqlstate '22023' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm = 'inventory_insufficient_stock' then
      return jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'product_id', v_detail);
    end if;
    if sqlerrm in ('payment_in_progress', 'payment_order_not_payable') then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end if;
    raise;
  end;
end;
$$;

revoke all on function
  private.store_zone_id(),
  private.stamp_sales_block(),
  private.log_sales_block_change(),
  private.sales_block_until(public.sales_blocks, timestamptz),
  private.sales_block_at(text, uuid, timestamptz),
  private.enforce_sales_blocks()
from public;

grant execute on function
  private.store_zone_id(),
  private.sales_block_at(text, uuid, timestamptz)
to authenticated;

revoke all on function public.get_sales_block(text, uuid) from public;
grant execute on function public.get_sales_block(text, uuid) to anon, authenticated, service_role;
