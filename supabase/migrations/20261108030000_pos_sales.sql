-- Point of sale (plan step 16, D-009, D-033, D-038, D-053).
--
-- - A POS sale is an order with channel 'pos': paid and delivered at once,
--   no reservation, no Wompi. It records the cashier, the payment method
--   (cash, card, transfer), the cash received and the change, and the
--   cashier's legal-age confirmation (required).
-- - Prices are computed here: the default retail list (an anonymous retail
--   buyer, never the cashier's own account), or the list of a registered
--   customer the cashier identifies. To reuse the exact web rules (D-036)
--   quote_items() runs with the buyer's claims for a moment and the caller's
--   claims are restored. The function that creates the sale prices the items
--   itself: it never trusts an amount from its caller.
-- - Stock: pos_sale movements limited to what is AVAILABLE (on hand minus
--   web reservations, D-038); all or nothing, one transaction. The balance
--   CHECK constraints make two sales of the last bottle impossible.
-- - The sales-block trigger of step 15 rejects POS orders during a rule.
-- - The invoice is enqueued (consumidor final or the identified customer).
-- - Only an administrator voids a sale: stock comes back (return_in) and a
--   credit note is requested if the invoice was accepted.
-- - No offline sales and no cash register shifts yet (D-053).
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Orders: POS data
-- ---------------------------------------------------------------------------

alter table public.orders
  add column cashier_id uuid references auth.users (id) on delete restrict,
  add column pos_payment_method text check (pos_payment_method in ('cash', 'card', 'transfer')),
  add column cash_received_cop bigint check (cash_received_cop >= 0),
  add column change_cop bigint check (change_cop >= 0),
  -- The cashier confirmed in person that the buyer is of legal age (D-033).
  add column age_confirmed boolean,
  add column voided_at timestamptz,
  add column void_reason text check (void_reason is null or length(trim(void_reason)) between 3 and 300),
  add column voided_by uuid references auth.users (id) on delete set null,
  add constraint orders_pos_check check (
    channel <> 'pos'
    or (cashier_id is not null and pos_payment_method is not null and age_confirmed is true)
  ),
  add constraint orders_cash_check check (
    pos_payment_method is distinct from 'cash'
    or (cash_received_cop >= total_cop and change_cop = cash_received_cop - total_cop)
  ),
  add constraint orders_void_check check ((voided_at is null) = (void_reason is null));

create index orders_pos_idx on public.orders (cashier_id, created_at desc) where channel = 'pos';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.require_pos_staff()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_staff_role(array['cashier', 'admin']) then
    raise exception 'pos_forbidden' using errcode = '42501';
  end if;
end;
$$;

-- JWT claims of the buyer, built from the customers table (the same data the
-- server writes to app_metadata). Without a customer: an anonymous retail
-- buyer, so the cashier's own account never influences the price.
-- Null when the customer does not exist.
create function private.pos_buyer_claims(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
begin
  perform private.require_pos_staff();
  if p_customer_id is null then
    return jsonb_build_object('role', 'authenticated', 'app_metadata', jsonb_build_object('customer_type', 'retail'));
  end if;
  select * into v_customer from public.customers where id = p_customer_id;
  if v_customer.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'sub', v_customer.id,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'customer_type', v_customer.customer_type,
      'wholesale_approved', v_customer.customer_type = 'wholesale' and v_customer.wholesale_status = 'approved'
    )
  );
end;
$$;

-- Units the POS can sell: on hand minus web reservations (no web safety
-- stock). Staff only: customers see only the web availability.
create function private.pos_available_units(p_product_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_pos_staff();
  return greatest(coalesce((select on_hand - reserved from public.product_stock where product_id = p_product_id), 0), 0);
end;
$$;

-- quote_items() (the web pricing, D-036) with the buyer's claims, restoring
-- the caller's claims afterwards. Null when the customer does not exist.
create function private.pos_quote(p_items jsonb, p_customer_id uuid)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_own text := current_setting('request.jwt.claims', true);
  v_claims jsonb := private.pos_buyer_claims(p_customer_id);
  v_quote jsonb;
begin
  if v_claims is null then
    return null;
  end if;
  perform set_config('request.jwt.claims', v_claims::text, true);
  v_quote := public.quote_items(p_items);
  perform set_config('request.jwt.claims', v_own, true);
  return v_quote;
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalog and customer lookup for the cashier
-- ---------------------------------------------------------------------------

-- What the POS can sell, priced for the buyer (default retail, or the
-- identified customer), with the available stock.
-- Returns {"ok": true, "sale_unit", "items": [...]} or {"ok": false, "error": "customer_not_found"}.
create function public.get_pos_catalog(p_customer_id uuid default null)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_own text := current_setting('request.jwt.claims', true);
  v_claims jsonb;
  v_rows jsonb;
begin
  perform private.require_pos_staff();
  v_claims := private.pos_buyer_claims(p_customer_id);
  if v_claims is null then
    return jsonb_build_object('ok', false, 'error', 'customer_not_found');
  end if;

  -- Priced as the buyer...
  perform set_config('request.jwt.claims', v_claims::text, true);
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', c.product_id, 'sku', c.sku, 'name', c.name, 'sale_unit', c.sale_unit,
    'units_per_box', c.units_per_box, 'min_quantity', c.min_quantity, 'price_cop', c.price_cop
  ) order by c.name, c.sku), '[]'::jsonb)
  into v_rows
  from public.get_catalog() c;
  -- ...and the stock read back as the cashier.
  perform set_config('request.jwt.claims', v_own, true);

  return jsonb_build_object(
    'ok', true,
    'sale_unit', coalesce(v_rows #>> '{0,sale_unit}', 'unit'),
    'items', coalesce((
      select jsonb_agg(r || jsonb_build_object(
        'available_units', a.units,
        'available_sale_units', case when r ->> 'sale_unit' = 'box'
          then a.units / (r ->> 'units_per_box')::integer else a.units end
      ) order by ord)
      from jsonb_array_elements(v_rows) with ordinality as e(r, ord)
      cross join lateral (select private.pos_available_units((r ->> 'product_id')::uuid) as units) a
    ), '[]'::jsonb)
  );
end;
$$;

-- Finds a registered customer by document number (digits) or email. Only
-- wholesale customers register a document (NIT, D-035), so retail customers
-- are found by email. Returns only what the cashier needs, or null.
create function public.find_pos_customer(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
  v_customer public.customers;
begin
  perform private.require_pos_staff();
  if position('@' in v_query) > 0 then
    select c.* into v_customer
    from public.customers c join auth.users u on u.id = c.id
    where lower(u.email) = v_query;
  elsif regexp_replace(v_query, '[^0-9]', '', 'g') ~ '^[0-9]{5,15}$' then
    select * into v_customer from public.customers
    where document_number = regexp_replace(v_query, '[^0-9]', '', 'g');
  end if;
  if v_customer.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_customer.id,
    'full_name', coalesce(v_customer.business_name, v_customer.full_name),
    'customer_type', v_customer.customer_type,
    'wholesale_status', v_customer.wholesale_status
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Sale
-- ---------------------------------------------------------------------------

-- Creates the sale. It trusts nothing from the caller: it checks the role
-- and the age confirmation and prices the items itself, so calling it
-- directly gives exactly what create_pos_sale gives. Errors are raised
-- (22023) and translated by create_pos_sale.
create function private.create_pos_order(
  p_idempotency_key uuid,
  p_items jsonb,
  p_payment_method text,
  p_cash_received_cop bigint,
  p_customer_id uuid,
  p_age_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashier uuid := auth.uid();
  v_action_id uuid;
  v_existing public.actions;
  v_quote jsonb;
  v_order_id uuid;
  v_total bigint;
  v_line jsonb;
  v_stock public.product_stock;
  v_units integer;
  v_product_id uuid;
begin
  perform private.require_pos_staff();

  insert into public.actions (idempotency_key, type, user_id, status, payload, attempts, started_at)
  values (p_idempotency_key, 'pos_sale', v_cashier, 'processing',
          jsonb_build_object('payment_method', p_payment_method, 'customer_id', p_customer_id), 1, now())
  on conflict (idempotency_key) do nothing
  returning id into v_action_id;

  if v_action_id is null then
    select * into v_existing from public.actions where idempotency_key = p_idempotency_key;
    if v_existing.user_id is distinct from v_cashier or v_existing.type <> 'pos_sale' then
      raise exception 'idempotency_key_conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object('ok', true, 'created', false, 'tracking_id', v_existing.id,
                              'order_id', v_existing.result ->> 'order_id');
  end if;

  if p_age_confirmed is distinct from true then
    raise exception 'pos_age_not_confirmed' using errcode = '22023';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'card', 'transfer') then
    raise exception 'pos_invalid_payment_method' using errcode = '22023';
  end if;

  v_quote := private.pos_quote(p_items, p_customer_id);
  if v_quote is null then
    raise exception 'pos_customer_not_found' using errcode = '22023';
  end if;
  if not (v_quote ->> 'ok')::boolean then
    raise exception 'pos_quote_failed' using errcode = '22023', detail = v_quote::text;
  end if;
  v_total := (v_quote ->> 'total_cop')::bigint;
  if p_payment_method = 'cash' and (p_cash_received_cop is null or p_cash_received_cop < v_total) then
    raise exception 'pos_cash_insufficient' using errcode = '22023',
      detail = jsonb_build_object('total_cop', v_total)::text;
  end if;

  -- The sales-block trigger (step 15) runs here and may reject the sale.
  insert into public.orders (
    customer_id, channel, status, fulfillment, sale_unit,
    subtotal_cop, delivery_fee_cop, total_cop, total_boxes, total_base_units,
    idempotency_key, paid_at, delivered_at,
    cashier_id, pos_payment_method, cash_received_cop, change_cop, age_confirmed
  ) values (
    p_customer_id, 'pos', 'delivered', 'pickup', v_quote ->> 'sale_unit',
    v_total, 0, v_total, (v_quote ->> 'total_boxes')::integer, (v_quote ->> 'total_base_units')::integer,
    p_idempotency_key, now(), now(),
    v_cashier, p_payment_method,
    case when p_payment_method = 'cash' then p_cash_received_cop end,
    case when p_payment_method = 'cash' then p_cash_received_cop - v_total end,
    p_age_confirmed
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
  end loop;

  -- Stock, in product order to avoid deadlocks. Only what is available:
  -- units reserved for pending web orders are never sold (D-038).
  for v_line in
    select value from jsonb_array_elements(v_quote -> 'lines') order by value ->> 'product_id'
  loop
    v_product_id := (v_line ->> 'product_id')::uuid;
    v_units := (v_line ->> 'base_units')::integer;
    v_stock := private.lock_stock(v_product_id);
    if v_stock.on_hand - v_stock.reserved < v_units then
      raise exception 'inventory_insufficient_stock' using errcode = '22023',
        detail = jsonb_build_object('product_id', v_product_id,
                                    'available_units', greatest(v_stock.on_hand - v_stock.reserved, 0))::text;
    end if;
    insert into public.inventory_movements
      (product_id, movement_type, units, reference, created_by, idempotency_key)
    values
      (v_product_id, 'pos_sale', -v_units, v_order_id::text, v_cashier,
       private.uuid_from_text('pos_sale:' || v_order_id || ':' || v_product_id));
  end loop;

  -- Same key as the web trigger: one invoice per order.
  perform public.enqueue_action(
    private.uuid_from_text('issue_invoice:' || v_order_id::text),
    'issue_invoice', null, jsonb_build_object('order_id', v_order_id), 8
  );

  update public.actions
  set status = 'succeeded', result = jsonb_build_object('order_id', v_order_id), finished_at = now()
  where id = v_action_id;

  return jsonb_build_object('ok', true, 'created', true, 'tracking_id', v_action_id, 'order_id', v_order_id);
end;
$$;

-- Registers a POS sale. Items: [{"product_id", "quantity"}] in the buyer's
-- sale unit; any price sent is ignored. Returns {"ok": true, "created",
-- "tracking_id", "order_id"} (the same shape on a retry) or {"ok": false,
-- "error": age_not_confirmed | invalid_payment_method | customer_not_found |
-- quote_failed | cash_insufficient | insufficient_stock | sales_blocked, ...}.
-- Nothing is created when it fails.
create function public.create_pos_sale(
  p_idempotency_key uuid,
  p_items jsonb,
  p_payment_method text,
  p_cash_received_cop bigint,
  p_customer_id uuid,
  p_age_confirmed boolean
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_existing public.actions;
  v_detail text;
begin
  perform private.require_pos_staff();
  if p_idempotency_key is null then
    raise exception 'pos_missing_idempotency_key' using errcode = '22023';
  end if;

  -- A retry of a sale already registered returns it.
  select * into v_existing from public.actions
  where idempotency_key = p_idempotency_key and user_id = auth.uid() and type = 'pos_sale'
    and status = 'succeeded';
  if found then
    return jsonb_build_object('ok', true, 'created', false, 'tracking_id', v_existing.id,
                              'order_id', v_existing.result ->> 'order_id');
  end if;

  begin
    return private.create_pos_order(
      p_idempotency_key, p_items, p_payment_method, p_cash_received_cop, p_customer_id, p_age_confirmed
    );
  exception when sqlstate '22023' then
    get stacked diagnostics v_detail = pg_exception_detail;
    case sqlerrm
      when 'pos_age_not_confirmed' then return jsonb_build_object('ok', false, 'error', 'age_not_confirmed');
      when 'pos_invalid_payment_method' then return jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
      when 'pos_customer_not_found' then return jsonb_build_object('ok', false, 'error', 'customer_not_found');
      when 'pos_quote_failed' then return jsonb_build_object('ok', false, 'error', 'quote_failed', 'quote', v_detail::jsonb);
      when 'pos_cash_insufficient' then return jsonb_build_object('ok', false, 'error', 'cash_insufficient') || v_detail::jsonb;
      when 'inventory_insufficient_stock' then return jsonb_build_object('ok', false, 'error', 'insufficient_stock') || v_detail::jsonb;
      when 'sales_blocked' then return jsonb_build_object('ok', false, 'error', 'sales_blocked', 'block', v_detail::jsonb);
      else raise;
    end case;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Void (administrator only)
-- ---------------------------------------------------------------------------

-- Gives the stock back and requests the credit note if the invoice was
-- accepted. While the invoice is being issued (pending or sent) the void
-- waits and the administrator retries, so an invoice is never accepted
-- without its note. A rejected invoice is not a valid document: the void
-- goes ahead and that invoice can no longer be sent (prepare_invoice).
-- The order row lock serializes this with prepare_invoice: if the void wins,
-- the queued invoice fails for good (the order is no longer invoiceable).
create function public.void_pos_sale(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_invoice public.invoices;
  v_item public.order_items;
  v_credit_note uuid;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if not private.has_staff_role(array['admin']) then
    raise exception 'pos_void_forbidden' using errcode = '42501';
  end if;
  if length(v_reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  select * into v_order from public.orders where id = p_order_id and channel = 'pos' for update;
  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;
  if v_order.voided_at is not null then
    return jsonb_build_object('ok', true, 'already_voided', true);
  end if;

  select * into v_invoice from public.invoices where order_id = p_order_id for update;
  if v_invoice.id is not null and v_invoice.status in ('pending', 'sent') then
    return jsonb_build_object('ok', false, 'error', 'invoice_in_progress', 'invoice_status', v_invoice.status);
  end if;

  for v_item in select * from public.order_items where order_id = p_order_id order by product_id
  loop
    insert into public.inventory_movements
      (product_id, movement_type, units, reference, reason, created_by, idempotency_key)
    values
      (v_item.product_id, 'return_in', v_item.base_units, p_order_id::text, 'Anulación POS: ' || v_reason,
       auth.uid(), private.uuid_from_text('pos_void:' || p_order_id || ':' || v_item.product_id));
  end loop;

  update public.orders
  set status = 'refunded', voided_at = now(), void_reason = v_reason, voided_by = auth.uid()
  where id = p_order_id;

  if v_invoice.status = 'accepted' then
    v_credit_note := public.request_credit_note(v_invoice.id, v_reason);
  end if;

  return jsonb_build_object('ok', true, 'already_voided', false, 'credit_note_id', v_credit_note);
end;
$$;

-- Order history: also the reason of a refund (void reason or refund flag).
create or replace function private.log_order_status()
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
      case new.status
        when 'cancelled' then new.cancel_reason
        when 'refunded' then coalesce(new.void_reason, new.refund_reason)
      end
    );
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoice: payment method of POS sales
-- ---------------------------------------------------------------------------

-- Same as step 14 (delivery line), plus the POS payment method instead of
-- the Wompi attempt: POS_CASH, POS_CARD or POS_TRANSFER (mapped to Factus
-- codes by the worker). A POS sale without a customer is "consumidor final".
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

  -- A voided POS sale: an invoice that was not accepted can never be sent
  -- (it would be accepted without a credit note).
  if v_invoice.id is not null and v_invoice.status <> 'accepted'
     and exists (select 1 from public.orders where id = p_order_id and voided_at is not null) then
    raise exception 'invoice_order_not_invoiceable' using errcode = '22023';
  end if;

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

    if v_order.channel = 'pos' then
      v_method := 'POS_' || upper(v_order.pos_payment_method);
    else
      select coalesce(a.payment_method_type, 'UNKNOWN') into v_method
      from public.payment_attempts a
      where a.order_id = p_order_id and a.status = 'approved'
      order by a.finalized_at desc limit 1;
    end if;

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

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.require_pos_staff(),
  private.pos_buyer_claims(uuid),
  private.pos_available_units(uuid),
  private.pos_quote(jsonb, uuid),
  private.create_pos_order(uuid, jsonb, text, bigint, uuid, boolean)
from public;

-- Callable by signed-in users because the public functions are SECURITY
-- INVOKER, but each checks the staff role inside, and create_pos_order
-- prices the items itself (it trusts no amount from its caller).
grant execute on function
  private.require_pos_staff(),
  private.pos_buyer_claims(uuid),
  private.pos_available_units(uuid),
  private.pos_quote(jsonb, uuid),
  private.create_pos_order(uuid, jsonb, text, bigint, uuid, boolean)
to authenticated;

revoke all on function
  public.get_pos_catalog(uuid),
  public.find_pos_customer(text),
  public.create_pos_sale(uuid, jsonb, text, bigint, uuid, boolean),
  public.void_pos_sale(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.get_pos_catalog(uuid),
  public.find_pos_customer(text),
  public.create_pos_sale(uuid, jsonb, text, bigint, uuid, boolean),
  public.void_pos_sale(uuid, text)
to authenticated;
