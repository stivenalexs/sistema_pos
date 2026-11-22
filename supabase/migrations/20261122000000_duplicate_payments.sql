-- Duplicate payments (D-071 finding, D-072).
--
-- A replaced ('abandoned') attempt keeps its Wompi checkout valid until it
-- expires, so a customer can pay the same order twice (two tabs). Until now
-- the second APPROVED event marked the whole ORDER for refund
-- ('payment_for_closed_order') even when it was paid or delivered: the order
-- left deliveries and pickup, and its refund would annul the invoice of a
-- real sale. Now only that payment ATTEMPT is marked for refund
-- ('duplicate_payment'); the order is untouched. A payment for a cancelled
-- order that is not yet marked for refund keeps the D-040 behavior.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

alter table public.payment_attempts
  add column refund_needed boolean not null default false,
  add column refund_reason text check (refund_reason in ('duplicate_payment')),
  add column refunded_at timestamptz,
  add column refunded_by uuid references auth.users (id) on delete set null,
  add column refund_reference text check (refund_reference is null or length(trim(refund_reference)) between 3 and 120),
  add column refund_note text check (refund_note is null or length(trim(refund_note)) between 3 and 300),
  add constraint payment_attempts_refund_reason_pair check (refund_needed = (refund_reason is not null)),
  add constraint payment_attempts_refunded_trio check (
    (refunded_at is null) = (refund_reference is null) and (refunded_at is null) = (refund_note is null)
  ),
  add constraint payment_attempts_refunded_needed check (refunded_at is null or refund_needed),
  -- Only money that was actually taken can be refunded.
  add constraint payment_attempts_refund_only_approved check (not refund_needed or status = 'approved');

create index payment_attempts_refund_pending_idx on public.payment_attempts (updated_at)
  where refund_needed and refunded_at is null;

-- ---------------------------------------------------------------------------
-- Applying an event (replaces the D-040 version; same answers)
-- ---------------------------------------------------------------------------

create or replace function public.apply_payment_event(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.payment_events;
  v_attempt public.payment_attempts;
  v_order public.orders;
  v_outcome text;
  v_items jsonb;
begin
  select * into v_event from public.payment_events where id = p_event_id for update;
  if v_event.id is null then
    raise exception 'payment_event_not_found' using errcode = '22023';
  end if;
  if v_event.processed_at is not null then
    return 'already_processed';
  end if;

  if v_event.event_type <> 'transaction.updated' or v_event.reference is null then
    v_outcome := 'not_a_transaction';
  else
    select * into v_attempt from public.payment_attempts
    where reference = v_event.reference for update;

    if v_attempt.id is null then
      v_outcome := 'unknown_reference';
    elsif v_event.amount_in_cents is distinct from v_attempt.amount_in_cents
       or v_event.currency is distinct from v_attempt.currency then
      -- Never accept a payment for a different amount: alert the admin.
      v_outcome := 'amount_mismatch';
    elsif v_attempt.status not in ('pending', 'abandoned') then
      v_outcome := 'already_final';
    elsif v_event.status = 'PENDING' then
      update public.payment_attempts
      set wompi_transaction_id = coalesce(wompi_transaction_id, v_event.transaction_id)
      where id = v_attempt.id;
      v_outcome := 'pending_ignored';
    elsif v_event.status in ('DECLINED', 'VOIDED', 'ERROR') then
      update public.payment_attempts
      set status = lower(v_event.status)::public.payment_attempt_status,
          wompi_transaction_id = coalesce(wompi_transaction_id, v_event.transaction_id),
          payment_method_type = v_event.payload #>> '{data,transaction,payment_method_type}',
          status_message = v_event.payload #>> '{data,transaction,status_message}',
          finalized_at = now()
      where id = v_attempt.id;
      v_outcome := 'applied_declined';
    elsif v_event.status = 'APPROVED' then
      update public.payment_attempts
      set status = 'approved',
          wompi_transaction_id = coalesce(wompi_transaction_id, v_event.transaction_id),
          payment_method_type = v_event.payload #>> '{data,transaction,payment_method_type}',
          status_message = v_event.payload #>> '{data,transaction,status_message}',
          finalized_at = now()
      where id = v_attempt.id;

      select * into v_order from public.orders where id = v_attempt.order_id for update;

      if v_order.status = 'awaiting_payment' then
        select jsonb_agg(jsonb_build_object('product_id', product_id, 'units', base_units))
        into v_items
        from public.order_items where order_id = v_order.id;

        begin
          -- Reservation -> web sale. Idempotent with the attempt id as key.
          perform public.consume_reservation(v_order.id::text, v_items, v_attempt.id);
          update public.orders
          set status = 'paid', paid_at = now()
          where id = v_order.id;
          -- The order is paid: an open attempt without a transaction is no
          -- longer usable (a later payment on it is still caught as a
          -- duplicate, D-072).
          update public.payment_attempts
          set status = 'abandoned'
          where order_id = v_order.id and id <> v_attempt.id
            and status = 'pending' and wompi_transaction_id is null;
        exception when sqlstate '22023' then
          -- Paid, but the stock is gone (reservation expired and sold): the
          -- order is paid and must be refunded by the admin (plan step 17).
          update public.orders
          set status = 'paid', paid_at = now(),
              needs_refund = true, refund_reason = 'insufficient_stock_after_payment'
          where id = v_order.id;
        end;
      elsif v_order.status = 'cancelled' and not v_order.needs_refund then
        -- Money arrived for an order that is no longer payable (e.g. cancelled
        -- after 24 hours): flag it for refund, do not reopen it (D-040).
        update public.orders
        set needs_refund = true, refund_reason = 'payment_for_closed_order'
        where id = v_order.id;
      else
        -- The order was already paid by another attempt (two tabs, a late
        -- checkout), or its refund is already counted: refund THIS payment
        -- only and leave the order alone, so it is still delivered and
        -- invoiced (D-072).
        update public.payment_attempts
        set refund_needed = true, refund_reason = 'duplicate_payment'
        where id = v_attempt.id;
      end if;
      v_outcome := 'applied_approved';
    else
      v_outcome := 'unknown_status';
    end if;
  end if;

  update public.payment_events
  set processed_at = now(), outcome = v_outcome
  where id = p_event_id;
  return v_outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoice: the payment method of the payment that paid the order
-- (replaces the D-053 version; only that lookup changes)
-- ---------------------------------------------------------------------------

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
      -- A duplicate payment (D-072) is refunded: never its method.
      where a.order_id = p_order_id and a.status = 'approved' and not a.refund_needed
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
-- Recording the refund of a duplicate payment
-- ---------------------------------------------------------------------------

-- The money is returned in the Wompi dashboard; this records it (D-055). No
-- credit note: a duplicate payment was never invoiced.
create function public.mark_attempt_refunded(p_attempt_id uuid, p_reference text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.payment_attempts;
  v_reference text := trim(coalesce(p_reference, ''));
  v_note text := trim(coalesce(p_note, ''));
begin
  perform private.require_admin();
  if length(v_reference) not between 3 and 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reference');
  end if;
  if length(v_note) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;
  select * into v_attempt from public.payment_attempts where id = p_attempt_id for update;
  if v_attempt.id is null or not v_attempt.refund_needed then
    return jsonb_build_object('ok', false, 'error', 'attempt_not_refundable');
  end if;
  if v_attempt.refunded_at is not null then
    return jsonb_build_object('ok', true, 'already_refunded', true);
  end if;
  update public.payment_attempts
  set refunded_at = now(), refunded_by = auth.uid(), refund_reference = v_reference, refund_note = v_note
  where id = p_attempt_id;
  insert into public.order_events (order_id, from_status, to_status, actor_id, reason)
  select o.id, o.status, o.status, auth.uid(),
         'Pago duplicado reembolsado (' || v_reference || '): ' || v_note
  from public.orders o where o.id = v_attempt.order_id;
  return jsonb_build_object('ok', true, 'already_refunded', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Panel: the refunds list and the summary also count duplicate payments
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_refunds()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(row_data order by sort_ts) from (
    select o.updated_at as sort_ts, jsonb_build_object(
      'kind', 'order', 'attempt_id', null,
      'order_id', o.id, 'status', o.status, 'total_cop', o.total_cop, 'refund_reason', o.refund_reason,
      'refund_amount_cop', coalesce(o.refund_amount_cop, o.total_cop),
      'products_only', o.refund_amount_cop is not null,
      'paid_at', o.paid_at, 'customer', coalesce(c.full_name, 'Cliente'), 'email', u.email,
      'transaction_id', (select a.wompi_transaction_id from public.payment_attempts a
                         where a.order_id = o.id and a.status = 'approved' and not a.refund_needed
                         order by a.finalized_at desc limit 1)
    ) as row_data
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join auth.users u on u.id = o.customer_id
    where o.needs_refund and o.refunded_at is null
    union all
    -- A duplicate payment: only that attempt's money goes back (D-072).
    select pa.updated_at, jsonb_build_object(
      'kind', 'payment', 'attempt_id', pa.id,
      'order_id', o.id, 'status', o.status, 'total_cop', pa.amount_in_cents / 100, 'refund_reason', pa.refund_reason,
      'refund_amount_cop', pa.amount_in_cents / 100, 'products_only', false,
      'paid_at', pa.finalized_at, 'customer', coalesce(c.full_name, 'Cliente'), 'email', u.email,
      'transaction_id', pa.wompi_transaction_id
    )
    from public.payment_attempts pa
    join public.orders o on o.id = pa.order_id
    left join public.customers c on c.id = o.customer_id
    left join auth.users u on u.id = o.customer_id
    where pa.refund_needed and pa.refunded_at is null
    ) s
  ), '[]'::jsonb);
end;
$$;

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
  -- After the role check (D-056): nothing costly before it.
  v_inventory := private.inventory_alert_counts();
  return jsonb_build_object(
    'pending_wholesale', (select count(*) from public.customers where wholesale_status = 'pending'),
    'staff', (select count(*) from auth.users where raw_app_meta_data ? 'staff_role' and email_confirmed_at is not null),
    'pending_invitations', (select count(*) from public.staff_invitations where status = 'pending' and expires_at > now()),
    'invoices_attention', (
      select count(*) from public.invoices i
      join public.orders o on o.id = i.order_id
      left join public.actions a on a.idempotency_key = private.uuid_from_text('issue_invoice:' || i.order_id::text)
      where i.status <> 'accepted' and (i.status = 'rejected' or a.status = 'failed')
        -- A voided POS sale or an order to refund is no longer invoiced.
        and o.voided_at is null and not o.needs_refund
    ) + (
      select count(*) from public.credit_notes n
      left join public.actions a on a.idempotency_key = private.uuid_from_text('issue_credit_note:' || n.id::text)
      where n.status <> 'accepted' and (n.status = 'rejected' or a.status = 'failed')
    ),
    'failed_actions', (select count(*) from public.actions where status = 'failed'),
    'queue_stuck', (select count(*) from public.actions
                    where (status = 'queued' and coalesce(next_attempt_at, created_at) < now() - interval '10 minutes')
                       or (status = 'processing' and updated_at < now() - interval '10 minutes')),
    'refunds_pending', (select count(*) from public.orders where needs_refund and refunded_at is null)
      + (select count(*) from public.payment_attempts where refund_needed and refunded_at is null),
    'low_stock', (v_inventory ->> 'low_stock')::integer,
    'stock_mismatches', (v_inventory ->> 'stock_mismatches')::integer,
    'deliveries_to_assign', (
      select count(*) from public.orders
      where channel = 'web' and fulfillment = 'delivery' and not needs_refund and status in ('paid', 'preparing')
        and not (delivery_return_kind is not distinct from 'customer' and return_choice is null)
    ),
    'deliveries_failed', (
      select count(*) from public.orders
      where channel = 'web' and fulfillment = 'delivery' and not needs_refund and status = 'preparing'
        and delivery_return_kind = 'customer' and return_choice is null
    ),
    'pickups_attention', (
      select count(*) from public.orders o
      join public.customers c on c.id = o.customer_id
      left join private.order_pickup_documents d on d.order_id = o.id
      where o.channel = 'web' and o.fulfillment = 'pickup' and not o.needs_refund
        and o.status in ('paid', 'preparing')
        and not exists (select 1 from public.pickup_confirmations pc where pc.order_id = o.id)
        and (coalesce(d.failed_attempts, 0) >= 5
             or (d.document_hash is null and c.document_type is distinct from 'nit'))
    )
  );
end;
$$;

revoke all on function public.mark_attempt_refunded(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_attempt_refunded(uuid, text, text) to authenticated;
