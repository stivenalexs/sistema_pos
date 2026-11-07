-- Catalog and server-side pricing by customer type (plan step 9, D-036).
--
-- Prices are ALWAYS computed here, never trusted from the browser. Both
-- functions are SECURITY INVOKER: they run with the caller's permissions, so
-- the RLS of products, price_lists and product_prices still applies
-- (imported products and wholesale prices never reach a retail customer).
--
-- Rules:
--   - Approved wholesale customers buy by box; everyone else (visitors,
--     retail and pending wholesale customers) buys by unit (D-024, D-036).
--   - Price = the customer's special list if it has the product, otherwise
--     the default list of the customer's sale type.
--   - Products without a price, and box-only products for unit buyers, are
--     not shown.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- Price list type the current caller buys with.
create function private.pricing_customer_type()
returns public.customer_type
language sql
stable
set search_path = ''
as $$
  select case
    when private.is_approved_wholesale() then 'wholesale'::public.customer_type
    else 'retail'::public.customer_type
  end;
$$;

revoke all on function private.pricing_customer_type() from public;
grant execute on function private.pricing_customer_type() to anon, authenticated, service_role;

-- What the current caller can see and buy, with its price.
create function public.get_catalog()
returns table (
  product_id uuid,
  sku text,
  name text,
  description text,
  brand text,
  volume_ml integer,
  origin public.product_origin,
  sale_unit text,
  units_per_box integer,
  min_quantity integer,
  price_cop bigint,
  price_list_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ctx as (
    select private.pricing_customer_type() as ptype,
           private.assigned_price_list_id() as assigned
  ),
  lists as (
    select
      -- Special list: only if it matches the sale type (a pending wholesale
      -- customer never gets wholesale prices) and RLS lets the caller see it.
      (select pl.id from public.price_lists pl, ctx
        where pl.id = ctx.assigned and pl.customer_type = ctx.ptype) as special_id,
      (select pl.id from public.price_lists pl, ctx
        where pl.is_default and pl.customer_type = ctx.ptype) as default_id
  )
  select
    p.id,
    p.sku,
    p.name,
    p.description,
    p.brand,
    p.volume_ml,
    p.origin,
    case when ctx.ptype = 'wholesale' then 'box' else 'unit' end,
    p.units_per_box,
    case when ctx.ptype = 'wholesale' then p.wholesale_min_boxes else p.retail_min_units end,
    coalesce(sp.price_cop, dp.price_cop),
    coalesce(sp.price_list_id, dp.price_list_id)
  from public.products p
  cross join ctx
  cross join lists
  left join public.product_prices sp
    on sp.product_id = p.id and sp.price_list_id = lists.special_id
  left join public.product_prices dp
    on dp.product_id = p.id and dp.price_list_id = lists.default_id
  where p.is_active
    and coalesce(sp.price_cop, dp.price_cop) is not null
    and (
      ctx.ptype = 'wholesale'
      or (p.allow_retail_by_unit and p.origin = 'national')
    )
  order by p.name, p.sku;
$$;

-- Prices a list of items for the current caller.
-- Input: [{"product_id": "<uuid>", "quantity": <integer>}, ...]
-- Any other key (for example a price sent by the browser) is ignored.
-- Output:
--   {"ok": bool, "sale_unit": "unit"|"box", "total_cop": int,
--    "total_boxes": int, "total_base_units": int,
--    "lines": [{"index", "product_id", "quantity", "unit_price_cop",
--               "line_total_cop", "base_units", "error"}]}
-- Line errors: invalid_product, invalid_quantity, duplicate_product,
--              product_unavailable, below_minimum.
create function public.quote_items(p_items jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_sale_unit text := case
    when private.pricing_customer_type() = 'wholesale' then 'box' else 'unit' end;
  v_item jsonb;
  v_index integer := 0;
  v_product_id uuid;
  v_quantity integer;
  v_error text;
  v_row record;
  v_min integer;
  v_seen uuid[] := array[]::uuid[];
  v_lines jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_boxes integer := 0;
  v_base_units integer := 0;
  v_ok boolean := true;
begin
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 100 then
    raise exception 'quote_invalid_items' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    v_error := null;
    v_product_id := null;
    v_quantity := null;
    v_min := null;

    if jsonb_typeof(v_item -> 'product_id') = 'string'
       and (v_item ->> 'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_product_id := (v_item ->> 'product_id')::uuid;
    else
      v_error := 'invalid_product';
    end if;

    if v_error is null then
      if jsonb_typeof(v_item -> 'quantity') = 'number'
         and (v_item ->> 'quantity') ~ '^[0-9]{1,5}$'
         and (v_item ->> 'quantity')::integer between 1 and 10000 then
        v_quantity := (v_item ->> 'quantity')::integer;
      else
        v_error := 'invalid_quantity';
      end if;
    end if;

    if v_error is null and v_product_id = any (v_seen) then
      v_error := 'duplicate_product';
    end if;

    if v_error is null then
      v_seen := v_seen || v_product_id;
      select * into v_row from public.get_catalog() c where c.product_id = v_product_id;
      if not found then
        v_error := 'product_unavailable';
      else
        v_min := v_row.min_quantity;
        if v_quantity < v_min then
          v_error := 'below_minimum';
        end if;
      end if;
    end if;

    if v_error is null then
      v_total := v_total + v_row.price_cop * v_quantity;
      if v_sale_unit = 'box' then
        v_boxes := v_boxes + v_quantity;
        v_base_units := v_base_units + v_quantity * v_row.units_per_box;
      else
        v_base_units := v_base_units + v_quantity;
      end if;
      v_lines := v_lines || jsonb_build_object(
        'index', v_index,
        'product_id', v_product_id,
        'quantity', v_quantity,
        'unit_price_cop', v_row.price_cop,
        'line_total_cop', v_row.price_cop * v_quantity,
        'base_units', case when v_sale_unit = 'box'
                           then v_quantity * v_row.units_per_box else v_quantity end,
        'min_quantity', v_min,
        'error', null
      );
    else
      v_ok := false;
      v_lines := v_lines || jsonb_build_object(
        'index', v_index,
        'product_id', v_product_id,
        'quantity', v_quantity,
        'unit_price_cop', null,
        'line_total_cop', null,
        'base_units', null,
        'min_quantity', v_min,
        'error', v_error
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', v_ok,
    'sale_unit', v_sale_unit,
    'total_cop', case when v_ok then v_total else null end,
    'total_boxes', case when v_ok then v_boxes else null end,
    'total_base_units', case when v_ok then v_base_units else null end,
    'lines', v_lines
  );
end;
$$;

revoke all on function public.get_catalog() from public;
revoke all on function public.quote_items(jsonb) from public;
grant execute on function public.get_catalog() to anon, authenticated, service_role;
grant execute on function public.quote_items(jsonb) to anon, authenticated, service_role;
