-- Store pickup confirmed by the customer (plan step 18a, D-059, D-067).
--
-- A pickup web order is confirmed by its own customer ("Recogí mi pedido"),
-- as a protection against staff malpractice:
--   * customers without a registered NIT (retail) give, when placing the
--     order, the cédula of whoever will pick it up. Only an HMAC of it is kept
--     (keyed per order and with a secret pepper) plus its last 3 digits, in
--     private.order_pickup_documents: no API role reads it, not even staff
--     (the customer sees their own last 3 digits through get_pickup_status);
--   * customers with a registered NIT (wholesale) confirm with that NIT, with
--     or without its DIAN check digit.
-- Each order is confirmed with the method it was placed with.
-- confirm_pickup compares the document, records a pickup confirmation
-- (insert-only, the pickup's proof of delivery) and moves the order to
-- 'delivered'. Five wrong documents lock the confirmation for the admin.
-- Staff still check the physical cédula for the age (D-007).
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Pepper for the document HMAC. Generated here, never leaves the database and
-- lives in the private schema, which the API does not expose.
-- ---------------------------------------------------------------------------

create table private.pickup_secrets (
  id boolean primary key default true check (id),
  pepper bytea not null check (length(pepper) = 32),
  created_at timestamptz not null default now()
);
alter table private.pickup_secrets enable row level security;
revoke all on table private.pickup_secrets from public, anon, authenticated;

insert into private.pickup_secrets (pepper) values (extensions.gen_random_bytes(32));

-- Digits of a cédula as typed (dots, spaces and dashes allowed), or null if it
-- is not 5 to 12 digits (same rule as the delivery proof, D-045).
create function private.normalize_id_document(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v ~ '^[0-9]{5,12}$' then v
  end
  from (select regexp_replace(coalesce(p_value, ''), '[.\s-]', '', 'g') as v) s;
$$;

-- Fails closed: without the pepper it raises instead of returning null.
create function private.pickup_document_hash(p_order_id uuid, p_digits text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pepper bytea;
begin
  select pepper into v_pepper from private.pickup_secrets;
  if v_pepper is null or p_order_id is null or p_digits is null then
    raise exception 'pickup_document_hash_unavailable' using errcode = 'P0001';
  end if;
  return encode(
    extensions.hmac(convert_to(p_order_id::text || ':' || p_digits, 'UTF8'), v_pepper, 'sha256'),
    'hex'
  );
end;
$$;

-- DIAN check digit (dígito de verificación) of a NIT given as digits.
create function private.nit_check_digit(p_nit text)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select case when r < 2 then r else 11 - r end
  from (
    select sum(substr(reverse(p_nit), i, 1)::integer
               * (array[3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71])[i]) % 11 as r
    from generate_series(1, length(p_nit)) as i
  ) s
  where p_nit ~ '^[0-9]{1,15}$';
$$;

-- Whether a typed NIT is the registered one. The registration accepts it
-- with or without the check digit (D-035), so one extra trailing digit on
-- either side is accepted only when it is the real DIAN check digit of the
-- rest: never a truncated or altered number.
create function private.nit_matches(p_typed text, p_registered text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_typed = p_registered
    or (length(p_typed) = length(p_registered) + 1
        and left(p_typed, -1) = p_registered
        and right(p_typed, 1)::integer = private.nit_check_digit(p_registered))
    or (length(p_registered) = length(p_typed) + 1
        and left(p_registered, -1) = p_typed
        and right(p_registered, 1)::integer = private.nit_check_digit(p_typed)),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Who may pick up: outside public.orders, which staff (cashier, warehouse)
-- read in full (D-031). No API role reads this table; only the functions of
-- this migration do. One row per web pickup order; orders placed before this
-- step have none.
-- ---------------------------------------------------------------------------

create table private.order_pickup_documents (
  order_id uuid primary key references public.orders (id) on delete restrict,
  -- HMAC of the cédula (retail); null when the customer confirms with a NIT.
  document_hash text check (document_hash ~ '^[0-9a-f]{64}$'),
  document_last3 text check (document_last3 ~ '^[0-9]{3}$'),
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_pickup_documents_pair check ((document_hash is null) = (document_last3 is null))
);
alter table private.order_pickup_documents enable row level security;
revoke all on table private.order_pickup_documents from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pickup confirmations: the proof of delivery of a pickup order
-- ---------------------------------------------------------------------------

create table public.pickup_confirmations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  confirmed_by uuid not null references auth.users (id) on delete restrict,
  document_kind text not null check (document_kind in ('cedula', 'nit')),
  confirmed_at timestamptz not null default now(),
  constraint pickup_confirmations_order_key unique (order_id)
);

create trigger pickup_confirmations_insert_only before update or delete on public.pickup_confirmations
  for each row execute function private.forbid_change();

alter table public.pickup_confirmations enable row level security;

create policy "pickup_confirmations: customer reads own"
  on public.pickup_confirmations for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = pickup_confirmations.order_id and o.customer_id = (select auth.uid())
  ));

create policy "pickup_confirmations: admin reads"
  on public.pickup_confirmations for select to authenticated
  using ((select private.has_staff_role(array['admin'])));

-- Nobody writes from the API: only confirm_pickup (D-052).
revoke all on table public.pickup_confirmations from public, anon, authenticated;
grant select on table public.pickup_confirmations to authenticated;

-- A web order is never 'delivered' without its proof (D-007): the signed
-- delivery proof, or for a pickup order its pickup confirmation.
create or replace function private.require_delivery_proof()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.channel = 'web'
     and not exists (select 1 from public.delivery_proofs where order_id = new.id)
     and not (
       new.fulfillment = 'pickup'
       and exists (select 1 from public.pickup_confirmations where order_id = new.id)
     ) then
    raise exception 'order_delivered_without_proof' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Placing a web order: the pickup document (replaces the 17d-3 version)
-- ---------------------------------------------------------------------------

drop function public.place_order(uuid, public.fulfillment_method, uuid);
drop function private.create_web_order(uuid, public.fulfillment_method, uuid);

create function private.create_web_order(
  p_idempotency_key uuid,
  p_fulfillment public.fulfillment_method,
  p_address_id uuid,
  p_pickup_document text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_action_id uuid;
  v_existing public.actions;
  v_items jsonb;
  v_quote jsonb;
  v_order_id uuid := gen_random_uuid();
  v_ttl integer;
  v_window integer;
  v_line jsonb;
  v_reserve jsonb := '[]'::jsonb;
  v_delivery jsonb;
  v_fee bigint := 0;
  v_subtotal bigint;
  v_document text;
begin
  -- Who: only the signed-in customer, for their own cart.
  if v_customer_id is null or not exists (select 1 from public.customers where id = v_customer_id) then
    raise exception 'order_requires_customer' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'order_missing_idempotency_key' using errcode = '22023';
  end if;

  -- A retry of an order already placed returns it, even with an empty cart.
  select * into v_existing from public.actions where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.user_id is distinct from v_customer_id or v_existing.type <> 'place_order' then
      raise exception 'idempotency_key_conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'ok', true, 'created', false,
      'tracking_id', v_existing.id,
      'order_id', v_existing.result ->> 'order_id'
    );
  end if;

  -- What and at what price: the cart and the quote are computed here, never
  -- received (agents.md §5.1).
  v_items := public.get_cart_items();
  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'cart_empty');
  end if;
  v_quote := public.quote_items(v_items);
  if not (v_quote ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'quote_failed', 'quote', v_quote);
  end if;
  v_subtotal := (v_quote ->> 'total_cop')::bigint;

  -- Pickup (D-059): customers without a registered NIT say whose cédula will
  -- pick the order up. Customers with a NIT confirm with it.
  if p_fulfillment = 'pickup' and not exists (
    select 1 from public.customers where id = v_customer_id and document_type = 'nit'
  ) then
    if nullif(btrim(coalesce(p_pickup_document, '')), '') is null then
      return jsonb_build_object('ok', false, 'error', 'pickup_document_required');
    end if;
    v_document := private.normalize_id_document(p_pickup_document);
    if v_document is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_pickup_document');
    end if;
  end if;

  -- Layer 3 of idempotency: the action key is UNIQUE. A concurrent second
  -- call waits here for the first one and then returns its result. The
  -- document is never stored in the payload.
  insert into public.actions (idempotency_key, type, user_id, status, payload, attempts, started_at)
  values (p_idempotency_key, 'place_order', v_customer_id, 'processing',
          jsonb_build_object('fulfillment', p_fulfillment, 'address_id', p_address_id), 1, now())
  on conflict (idempotency_key) do nothing
  returning id into v_action_id;

  if v_action_id is null then
    select * into v_existing from public.actions where idempotency_key = p_idempotency_key;
    if v_existing.user_id is distinct from v_customer_id or v_existing.type <> 'place_order' then
      raise exception 'idempotency_key_conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'ok', true, 'created', false,
      'tracking_id', v_existing.id,
      'order_id', v_existing.result ->> 'order_id'
    );
  end if;

  -- After the role and idempotency checks (D-056: nothing costly before them).
  v_ttl := private.setting_integer('reservation_ttl_minutes', 30);
  v_window := private.setting_integer('order_payment_window_hours', 24);

  if p_fulfillment = 'delivery' then
    -- The fee is always computed here, never received (agents.md §5.1).
    v_delivery := private.delivery_quote(
      p_address_id, v_customer_id, v_quote ->> 'sale_unit', (v_quote ->> 'total_boxes')::integer
    );
    if not (v_delivery ->> 'ok')::boolean then
      raise exception 'order_delivery_unavailable'
        using errcode = '22023', detail = v_delivery ->> 'error';
    end if;
    v_fee := (v_delivery ->> 'fee_cop')::bigint;
  end if;

  insert into public.orders (
    id, customer_id, channel, status, fulfillment, sale_unit,
    subtotal_cop, delivery_fee_cop, total_cop, total_boxes, total_base_units,
    idempotency_key, payment_deadline, cancel_after,
    delivery_address, delivery_distance_m
  ) values (
    v_order_id, v_customer_id, 'web', 'awaiting_payment', p_fulfillment, v_quote ->> 'sale_unit',
    v_subtotal, v_fee, v_subtotal + v_fee,
    (v_quote ->> 'total_boxes')::integer, (v_quote ->> 'total_base_units')::integer,
    p_idempotency_key, now() + make_interval(mins => v_ttl), now() + make_interval(hours => v_window),
    v_delivery -> 'address', (v_delivery ->> 'distance_m')::integer
  );

  if p_fulfillment = 'pickup' then
    insert into private.order_pickup_documents (order_id, document_hash, document_last3)
    values (
      v_order_id,
      case when v_document is not null then private.pickup_document_hash(v_order_id, v_document) end,
      case when v_document is not null then right(v_document, 3) end
    );
  end if;

  for v_line in select value from jsonb_array_elements(v_quote -> 'lines')
  loop
    insert into public.order_items (
      order_id, product_id, sku, product_name, sale_unit, units_per_box,
      quantity, unit_price_cop, line_total_cop, base_units
    )
    select
      v_order_id, p.id, p.sku, p.name, v_quote ->> 'sale_unit', p.units_per_box,
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
  perform private.reserve_units(v_order_id::text, v_reserve, v_ttl, v_customer_id);

  delete from public.cart_items
  where cart_id = (select id from public.carts where customer_id = v_customer_id);

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

revoke all on function private.create_web_order(uuid, public.fulfillment_method, uuid, text) from public;
-- place_order (SECURITY INVOKER) calls it with the customer's session; it
-- trusts nothing from its caller, so calling it directly gives the same.
grant execute on function private.create_web_order(uuid, public.fulfillment_method, uuid, text) to authenticated;

-- Same answers as before (D-039, D-045, D-051, D-066), plus
-- 'pickup_document_required' and 'invalid_pickup_document'.
create function public.place_order(
  p_idempotency_key uuid,
  p_fulfillment public.fulfillment_method default 'pickup',
  p_address_id uuid default null,
  p_pickup_document text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_detail text;
begin
  return private.create_web_order(p_idempotency_key, p_fulfillment, p_address_id, p_pickup_document);
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
$$;

revoke all on function public.place_order(uuid, public.fulfillment_method, uuid, text) from public, anon, authenticated;
grant execute on function public.place_order(uuid, public.fulfillment_method, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- "Recogí mi pedido"
-- ---------------------------------------------------------------------------

-- What the customer's order page shows: the last 3 digits of the cédula and
-- whether too many wrong documents locked it. Only for the customer's own
-- order; null otherwise.
create function public.get_pickup_status(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'document_last3', d.document_last3,
    'locked', coalesce(d.failed_attempts, 0) >= 5
  )
  from public.orders o
  left join private.order_pickup_documents d on d.order_id = o.id
  where o.id = p_order_id
    and o.customer_id = (select auth.uid())
    and o.channel = 'web' and o.fulfillment = 'pickup';
$$;

-- Answers {"ok": true, "already_confirmed": bool} or
-- {"ok": false, "error": "order_not_found"|"not_pickup_order"|"pickup_not_available"
--   |"pickup_locked"|"invalid_document"|"pickup_document_missing"
--   |"document_mismatch", "attempts_left"?: n}
create function public.confirm_pickup(p_order_id uuid, p_document text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_attempts constant integer := 5;
  v_uid uuid := auth.uid();
  v_order public.orders;
  v_doc private.order_pickup_documents;
  v_digits text;
  v_nit text;
  v_kind text;
  v_match boolean;
  v_failed integer;
begin
  if v_uid is null then
    raise exception 'pickup_requires_customer' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  -- Another customer's order looks the same as a missing one.
  if not found or v_order.customer_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  -- Idempotent: a second click after the confirmation answers the same.
  if exists (select 1 from public.pickup_confirmations where order_id = p_order_id) then
    return jsonb_build_object('ok', true, 'already_confirmed', true);
  end if;

  if v_order.channel <> 'web' or v_order.fulfillment <> 'pickup' then
    return jsonb_build_object('ok', false, 'error', 'not_pickup_order');
  end if;
  if v_order.status not in ('paid', 'preparing') or v_order.needs_refund then
    return jsonb_build_object('ok', false, 'error', 'pickup_not_available');
  end if;

  select * into v_doc from private.order_pickup_documents where order_id = p_order_id;
  if coalesce(v_doc.failed_attempts, 0) >= c_max_attempts then
    return jsonb_build_object('ok', false, 'error', 'pickup_locked');
  end if;

  v_digits := private.normalize_id_document(p_document);
  if v_digits is null then
    -- A malformed value is not counted as an attempt.
    return jsonb_build_object('ok', false, 'error', 'invalid_document');
  end if;

  -- Each order is confirmed with the method it was placed with: the cédula
  -- given at order time if there is one, otherwise the registered NIT.
  if v_doc.document_hash is not null then
    v_kind := 'cedula';
    v_match := private.pickup_document_hash(v_order.id, v_digits) = v_doc.document_hash;
  else
    select replace(document_number, '-', '') into v_nit
    from public.customers
    where id = v_uid and document_type = 'nit';
    if v_nit is null then
      -- Orders placed before step 18a: the store resolves them.
      return jsonb_build_object('ok', false, 'error', 'pickup_document_missing');
    end if;
    v_kind := 'nit';
    v_match := private.nit_matches(v_digits, v_nit);
  end if;

  -- Fails closed: a comparison that could not be made is a mismatch.
  if v_match is not true then
    insert into private.order_pickup_documents (order_id, failed_attempts)
    values (v_order.id, 1)
    on conflict (order_id) do update
      set failed_attempts = private.order_pickup_documents.failed_attempts + 1,
          updated_at = now()
    returning failed_attempts into v_failed;
    return jsonb_build_object(
      'ok', false, 'error', 'document_mismatch',
      'attempts_left', greatest(c_max_attempts - v_failed, 0)
    );
  end if;

  insert into public.pickup_confirmations (order_id, confirmed_by, document_kind)
  values (v_order.id, v_uid, v_kind);

  update public.orders
  set status = 'delivered', delivered_at = now()
  where id = v_order.id;

  return jsonb_build_object('ok', true, 'already_confirmed', false);
end;
$$;

revoke all on function
  private.normalize_id_document(text),
  private.pickup_document_hash(uuid, text),
  private.nit_check_digit(text),
  private.nit_matches(text, text),
  public.get_pickup_status(uuid),
  public.confirm_pickup(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.get_pickup_status(uuid),
  public.confirm_pickup(uuid, text)
to authenticated;
