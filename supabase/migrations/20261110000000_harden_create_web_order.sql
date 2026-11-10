-- Harden private.create_web_order (plan step 17d-3, D-066).
--
-- Until now place_order quoted the cart and passed the quote (prices, totals,
-- sale unit) to private.create_web_order, which trusted it. The private
-- schema is not exposed by the API, but a function that creates orders must
-- not accept prices from its caller (agents.md §5.1), as was done for the POS
-- (private.create_pos_order, D-053).
--
-- Now private.create_web_order(key, fulfillment, address) takes the customer
-- from the session, reads that customer's cart and quotes it itself with
-- quote_items. get_catalog/quote_items decide visibility and prices from the
-- session claims (customer type, wholesale approval, assigned list), not from
-- RLS, so quoting here gives exactly what the customer would get. The
-- delivery fee was already computed inside (private.delivery_quote).
-- place_order becomes a thin wrapper with the same answers as before.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

drop function private.create_web_order(uuid, uuid, public.fulfillment_method, jsonb, uuid);

create function private.create_web_order(
  p_idempotency_key uuid,
  p_fulfillment public.fulfillment_method,
  p_address_id uuid
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
  v_order_id uuid;
  v_ttl integer;
  v_window integer;
  v_line jsonb;
  v_reserve jsonb := '[]'::jsonb;
  v_delivery jsonb;
  v_fee bigint := 0;
  v_subtotal bigint;
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

  -- Layer 3 of idempotency: the action key is UNIQUE. A concurrent second
  -- call waits here for the first one and then returns its result.
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
    customer_id, channel, status, fulfillment, sale_unit,
    subtotal_cop, delivery_fee_cop, total_cop, total_boxes, total_base_units,
    idempotency_key, payment_deadline, cancel_after,
    delivery_address, delivery_distance_m
  ) values (
    v_customer_id, 'web', 'awaiting_payment', p_fulfillment, v_quote ->> 'sale_unit',
    v_subtotal, v_fee, v_subtotal + v_fee,
    (v_quote ->> 'total_boxes')::integer, (v_quote ->> 'total_base_units')::integer,
    p_idempotency_key, now() + make_interval(mins => v_ttl), now() + make_interval(hours => v_window),
    v_delivery -> 'address', (v_delivery ->> 'distance_m')::integer
  )
  returning id into v_order_id;

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

revoke all on function private.create_web_order(uuid, public.fulfillment_method, uuid) from public;
-- place_order (SECURITY INVOKER) calls it with the customer's session; it
-- trusts nothing from its caller, so calling it directly gives the same.
grant execute on function private.create_web_order(uuid, public.fulfillment_method, uuid) to authenticated;

-- Same signature and answers as before (D-039, D-045, D-051).
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
  v_detail text;
begin
  return private.create_web_order(p_idempotency_key, p_fulfillment, p_address_id);
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
