-- Admin panel, part C: inventory (plan step 17c, D-056).
--
-- 1. Harder idempotency for the staff movements (record_stock_entry,
--    record_count, record_waste): the key is required, and a key already
--    used for another product, movement type or user is rejected
--    (inventory_idempotency_key_conflict) instead of returning someone
--    else's movement. The key is checked again after locking the product,
--    so two simultaneous submissions with the same key record one movement.
-- 2. Stock settings per product (low_stock_threshold, web_safety_stock),
--    editable by admin and warehouse through set_stock_settings, with an
--    insert-only history.
-- 3. Panel reads for admin and warehouse: inventory_overview,
--    inventory_recent_movements, inventory_alerts.
-- 4. admin_summary adds low-stock products and ledger mismatches.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Idempotency key check
-- ---------------------------------------------------------------------------

-- Movement already recorded with this key by the same caller for the same
-- product and type, or null. Raises when the key is missing or belongs to a
-- different movement.
create function private.inventory_movement_for_key(
  p_key uuid,
  p_product_id uuid,
  p_type public.inventory_movement_type
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_row public.inventory_movements;
begin
  if p_key is null then
    perform private.inventory_error('missing_idempotency_key');
  end if;
  select * into v_row from public.inventory_movements where idempotency_key = p_key;
  if v_row.id is null then
    return null;
  end if;
  if v_row.product_id <> p_product_id
     or v_row.movement_type <> p_type
     or v_row.created_by is distinct from auth.uid() then
    perform private.inventory_error('idempotency_key_conflict');
  end if;
  return v_row.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff movements (same signatures and error codes as D-038)
-- ---------------------------------------------------------------------------

create or replace function public.record_stock_entry(
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
  v_id := private.inventory_movement_for_key(p_idempotency_key, p_product_id, 'purchase_in');
  if v_id is not null then return v_id; end if;
  if p_units is null or p_units <= 0 or p_units > 100000 then perform private.inventory_error('invalid_units'); end if;
  if length(trim(coalesce(p_reference, ''))) = 0 or length(trim(p_reference)) > 120 then
    perform private.inventory_error('missing_reference');
  end if;
  if length(trim(coalesce(p_reason, ''))) > 300 then perform private.inventory_error('invalid_reason'); end if;

  perform private.lock_stock(p_product_id);
  -- A simultaneous submission with the same key may have committed while
  -- this one waited for the lock.
  v_id := private.inventory_movement_for_key(p_idempotency_key, p_product_id, 'purchase_in');
  if v_id is not null then return v_id; end if;

  insert into public.inventory_movements
    (product_id, movement_type, units, reference, reason, created_by, idempotency_key)
  values
    (p_product_id, 'purchase_in', p_units, trim(p_reference), nullif(trim(p_reason), ''), auth.uid(), p_idempotency_key)
  returning id into v_id;
  return v_id;
end;
$$;

-- Cycle count. Returns null when the count matches the stock on hand.
create or replace function public.record_count(
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
  v_id := private.inventory_movement_for_key(p_idempotency_key, p_product_id, 'adjustment');
  if v_id is not null then return v_id; end if;
  if p_counted_units is null or p_counted_units < 0 or p_counted_units > 1000000 then
    perform private.inventory_error('invalid_units');
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then perform private.inventory_error('missing_reason'); end if;
  if length(trim(p_reason)) > 300 then perform private.inventory_error('invalid_reason'); end if;

  v_stock := private.lock_stock(p_product_id);
  -- Without this second check, a simultaneous submission with the same key
  -- would see the corrected stock and answer "no difference".
  v_id := private.inventory_movement_for_key(p_idempotency_key, p_product_id, 'adjustment');
  if v_id is not null then return v_id; end if;

  if p_counted_units < v_stock.reserved then
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

create or replace function public.record_waste(
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
  v_id := private.inventory_movement_for_key(p_idempotency_key, p_product_id, 'waste');
  if v_id is not null then return v_id; end if;
  if p_units is null or p_units <= 0 or p_units > 100000 then perform private.inventory_error('invalid_units'); end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then perform private.inventory_error('missing_reason'); end if;
  if length(trim(p_reason)) > 300 then perform private.inventory_error('invalid_reason'); end if;

  v_stock := private.lock_stock(p_product_id);
  v_id := private.inventory_movement_for_key(p_idempotency_key, p_product_id, 'waste');
  if v_id is not null then return v_id; end if;

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

-- Replaced by private.inventory_movement_for_key in the three functions above;
-- nothing else used it.
drop function private.movement_by_key(uuid);

-- ---------------------------------------------------------------------------
-- Stock settings per product, with history
-- ---------------------------------------------------------------------------

create table public.stock_settings_changes (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key on purpose: like the other audit tables, the history
  -- outlives the row it describes.
  product_id uuid not null,
  old_low_stock_threshold integer not null,
  new_low_stock_threshold integer not null,
  old_web_safety_stock integer not null,
  new_web_safety_stock integer not null,
  changed_by uuid,
  created_at timestamptz not null default now()
);

create index stock_settings_changes_product_idx
  on public.stock_settings_changes (product_id, created_at desc);

create trigger stock_settings_changes_insert_only
  before update or delete on public.stock_settings_changes
  for each row execute function private.forbid_change();

revoke all on public.stock_settings_changes from anon, authenticated;
grant select on public.stock_settings_changes to authenticated;
alter table public.stock_settings_changes enable row level security;

create policy "stock_settings_changes: admin and warehouse read"
  on public.stock_settings_changes for select
  to authenticated
  using ((select private.has_staff_role(array['admin', 'warehouse'])));

-- Admin and warehouse. Values in base units, 0 to 100.000.
create function public.set_stock_settings(
  p_product_id uuid,
  p_low_stock_threshold integer,
  p_web_safety_stock integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
begin
  perform private.require_staff(array['admin', 'warehouse']);
  if p_low_stock_threshold is null or p_low_stock_threshold < 0 or p_low_stock_threshold > 100000
     or p_web_safety_stock is null or p_web_safety_stock < 0 or p_web_safety_stock > 100000 then
    perform private.inventory_error('invalid_settings');
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if v_product.id is null then perform private.inventory_error('unknown_product'); end if;

  if v_product.low_stock_threshold = p_low_stock_threshold
     and v_product.web_safety_stock = p_web_safety_stock then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.products
  set low_stock_threshold = p_low_stock_threshold, web_safety_stock = p_web_safety_stock
  where id = p_product_id;

  insert into public.stock_settings_changes (
    product_id, old_low_stock_threshold, new_low_stock_threshold,
    old_web_safety_stock, new_web_safety_stock, changed_by
  ) values (
    p_product_id, v_product.low_stock_threshold, p_low_stock_threshold,
    v_product.web_safety_stock, p_web_safety_stock, auth.uid()
  );
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Panel reads (admin and warehouse)
-- ---------------------------------------------------------------------------

-- Every product with its balance and settings.
create function public.inventory_overview()
returns table (
  product_id uuid,
  sku text,
  name text,
  origin public.product_origin,
  is_active boolean,
  units_per_box integer,
  on_hand integer,
  reserved integer,
  available integer,
  low_stock_threshold integer,
  web_safety_stock integer,
  is_low boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin', 'warehouse']);
  return query
    select p.id, p.sku, p.name, p.origin, p.is_active, p.units_per_box,
      coalesce(s.on_hand, 0), coalesce(s.reserved, 0),
      coalesce(s.on_hand, 0) - coalesce(s.reserved, 0),
      p.low_stock_threshold, p.web_safety_stock,
      p.is_active and coalesce(s.on_hand, 0) - coalesce(s.reserved, 0) <= p.low_stock_threshold
    from public.products p
    left join public.product_stock s on s.product_id = p.id
    order by p.is_active desc, p.name;
end;
$$;

-- Latest movements, newest first. Reservations and their releases are
-- left out unless asked for (they are frequent and automatic). Shows who
-- recorded each movement by the name of their staff invitation, or their
-- email when there is none (staff created by SQL).
create function public.inventory_recent_movements(
  p_product_id uuid default null,
  p_include_reservations boolean default false,
  p_limit integer default 50
)
returns table (
  movement_id uuid,
  created_at timestamptz,
  product_id uuid,
  sku text,
  product_name text,
  movement_type public.inventory_movement_type,
  units integer,
  reason text,
  reference text,
  recorded_by text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin', 'warehouse']);
  return query
    select m.id, m.created_at, m.product_id, p.sku, p.name, m.movement_type, m.units, m.reason, m.reference,
      case when m.created_by is null then null
        else coalesce(
          (select i.full_name from public.staff_invitations i
           where i.user_id = m.created_by order by i.created_at desc limit 1),
          (select u.email::text from auth.users u where u.id = m.created_by)
        )
      end
    from public.inventory_movements m
    join public.products p on p.id = m.product_id
    where (p_product_id is null or m.product_id = p_product_id)
      and (p_include_reservations or m.movement_type not in ('reservation', 'reservation_release'))
    order by m.created_at desc, m.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- Counters for the inventory page and the panel home.
create function private.inventory_alert_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'low_stock', (
      select count(*) from public.products p
      left join public.product_stock s on s.product_id = p.id
      where p.is_active and coalesce(s.on_hand, 0) - coalesce(s.reserved, 0) <= p.low_stock_threshold
    ),
    -- Must always be zero (D-038).
    'stock_mismatches', (select count(*) from public.reconcile_stock())
  );
$$;

create function public.inventory_alerts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(array['admin', 'warehouse']);
  return private.inventory_alert_counts();
end;
$$;

-- Panel home: also low stock and ledger mismatches.
create or replace function public.admin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inventory jsonb;
begin
  perform private.require_admin();
  -- After the role check: a DECLARE default would run before it, so any
  -- signed-in user could make the database sum the whole ledger.
  v_inventory := private.inventory_alert_counts();
  return jsonb_build_object(
    'pending_wholesale', (select count(*) from public.customers where wholesale_status = 'pending'),
    'staff', (select count(*) from auth.users where raw_app_meta_data ? 'staff_role' and email_confirmed_at is not null),
    'pending_invitations', (select count(*) from public.staff_invitations where status = 'pending' and expires_at > now()),
    'invoices_attention', (
      select count(*) from public.invoices i
      left join public.actions a on a.idempotency_key = private.uuid_from_text('issue_invoice:' || i.order_id::text)
      where i.status <> 'accepted' and (i.status = 'rejected' or a.status = 'failed')
    ) + (
      select count(*) from public.credit_notes n
      left join public.actions a on a.idempotency_key = private.uuid_from_text('issue_credit_note:' || n.id::text)
      where n.status <> 'accepted' and (n.status = 'rejected' or a.status = 'failed')
    ),
    'failed_actions', (select count(*) from public.actions where status = 'failed'),
    'queue_stuck', (select count(*) from public.actions
                    where (status = 'queued' and coalesce(next_attempt_at, created_at) < now() - interval '10 minutes')
                       or (status = 'processing' and updated_at < now() - interval '10 minutes')),
    'refunds_pending', (select count(*) from public.orders where needs_refund and refunded_at is null),
    'low_stock', (v_inventory ->> 'low_stock')::integer,
    'stock_mismatches', (v_inventory ->> 'stock_mismatches')::integer
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.inventory_movement_for_key(uuid, uuid, public.inventory_movement_type),
  private.inventory_alert_counts()
from public;

revoke all on function
  public.set_stock_settings(uuid, integer, integer),
  public.inventory_overview(),
  public.inventory_recent_movements(uuid, boolean, integer),
  public.inventory_alerts()
from public, anon, authenticated;

-- Each checks the admin or warehouse role inside.
grant execute on function
  public.set_stock_settings(uuid, integer, integer),
  public.inventory_overview(),
  public.inventory_recent_movements(uuid, boolean, integer),
  public.inventory_alerts()
to authenticated, service_role;
