-- Products-only refunds: stock back and a partial credit note (plan step
-- 18b-2, D-059, D-068, D-069).
--
-- After a failed delivery for an underage recipient, or when the customer
-- chooses the refund, the bottles are back at the store: they return to the
-- stock (return_in) at that moment, so the web and the POS can sell them
-- again. When the administrator records the refund (the money is returned in
-- the Wompi dashboard, D-055), an accepted invoice gets a PARTIAL credit note
-- (concept 1, "Devolución parcial de los bienes"): only the product lines,
-- the delivery line stays invoiced because the delivery was attempted.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Credit notes: whole invoice or products only
-- ---------------------------------------------------------------------------

alter table public.credit_notes
  add column kind text not null default 'full' check (kind in ('full', 'products_only')),
  -- Factus correction concept: 2 = annulment, 1 = partial return of goods.
  add column concept_code text not null default '2' check (concept_code in ('1', '2')),
  add constraint credit_notes_kind_concept_check check ((kind = 'full') = (concept_code = '2'));

-- One credit note per invoice (unchanged), of the given kind. Same checks as
-- public.request_credit_note, which keeps asking for a full one.
create function private.request_credit_note_kind(p_invoice_id uuid, p_reason text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_id uuid;
  v_existing_kind text;
begin
  if not (private.is_service_role() or private.has_staff_role(array['admin'])) then
    raise exception 'credit_note_forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('full', 'products_only') then
    raise exception 'credit_note_invalid_kind' using errcode = '22023';
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice.status <> 'accepted' then
    raise exception 'credit_note_invoice_not_accepted' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'credit_note_missing_reason' using errcode = '22023';
  end if;

  insert into public.credit_notes (invoice_id, reference_code, reason, requested_by, kind, concept_code)
  values (p_invoice_id, 'NC-' || upper(replace(p_invoice_id::text, '-', '')), trim(p_reason), auth.uid(),
          p_kind, case when p_kind = 'full' then '2' else '1' end)
  on conflict (invoice_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Idempotent for the same kind; a note of the other kind is an error,
    -- never returned as if it were the one asked for.
    select id, kind into v_id, v_existing_kind from public.credit_notes where invoice_id = p_invoice_id;
    if v_existing_kind <> p_kind then
      raise exception 'credit_note_kind_conflict' using errcode = '22023';
    end if;
    return v_id;
  end if;

  perform public.enqueue_action(
    private.uuid_from_text('issue_credit_note:' || v_id::text),
    'issue_credit_note', null, jsonb_build_object('credit_note_id', v_id), 8
  );
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stock back to the store
-- ---------------------------------------------------------------------------

-- Returns the units of a web order to the stock (return_in), once: the key
-- is derived from the order and the product.
create function private.return_order_stock(p_order_id uuid, p_reason text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items;
begin
  for v_item in select * from public.order_items where order_id = p_order_id order by product_id
  loop
    -- Same lock as every other stock change (D-038), in product order.
    perform private.lock_stock(v_item.product_id);
    insert into public.inventory_movements
      (product_id, movement_type, units, reference, reason, created_by, idempotency_key)
    values
      (v_item.product_id, 'return_in', v_item.base_units, p_order_id::text, p_reason, p_actor,
       private.uuid_from_text('delivery_return:' || p_order_id || ':' || v_item.product_id))
    on conflict (idempotency_key) do nothing;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Functions of step 18b-1 with the stock return (D-069)
-- ---------------------------------------------------------------------------

create or replace function public.record_delivery_attempt(
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
  v_kind text;
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
    v_kind := private.delivery_failure_kind(p_failure_reason);
    if v_kind is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_failure_reason');
    end if;
    insert into public.delivery_attempts
      (order_id, actor_id, outcome, failure_reason, notes, location, idempotency_key)
    values (p_order_id, p_actor_id, 'failed', p_failure_reason, v_notes, v_location, p_idempotency_key)
    returning id into v_attempt_id;

    -- Back to the store, without assignment (D-059). The history says who and why.
    perform private.set_order_event_context(
      p_actor_id, 'Entrega fallida: ' || p_failure_reason || coalesce(' — ' || v_notes, ''));
    update public.orders
    set status = 'preparing',
        delivery_provider_id = null, courier_id = null, delivery_external_ref = null, assigned_at = null,
        delivery_return_kind = v_kind, returned_at = now(),
        return_choice = null, return_choice_at = null, return_choice_defaulted = false,
        return_choice_deadline = case when v_kind = 'customer' then now() + interval '3 days' end,
        scheduled_delivery_on = case when v_kind = 'force_majeure' then private.bogota_tomorrow() end,
        needs_refund = needs_refund or v_kind = 'underage',
        refund_reason = case when v_kind = 'underage' then 'recipient_underage' else refund_reason end,
        refund_amount_cop = case when v_kind = 'underage' then subtotal_cop else refund_amount_cop end
    where id = p_order_id;

    perform private.set_order_event_context(null, null);
    if v_kind = 'underage' then
      -- The bottles are back at the store and can be sold again (D-069).
      perform private.return_order_stock(p_order_id, 'Domicilio fallido: menor de edad', p_actor_id);
    end if;
    perform private.enqueue_order_email('delivery_' || v_kind, p_order_id, v_attempt_id::text);

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

  perform private.set_order_event_context(p_actor_id, null);
  -- The return of an earlier attempt stays as history; the schedule is done.
  update public.orders
  set status = 'delivered', delivered_at = now(), scheduled_delivery_on = null
  where id = p_order_id;
  perform private.set_order_event_context(null, null);

  return jsonb_build_object('ok', true, 'duplicate', false, 'attempt_id', v_attempt_id, 'outcome', 'delivered');
end;
$$;

create or replace function public.choose_delivery_return_option(
  p_order_id uuid,
  p_option text,
  p_pickup_document text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders;
  v_digits text;
begin
  if v_uid is null then
    raise exception 'choice_requires_customer' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  if v_order.delivery_return_kind is distinct from 'customer' then
    return jsonb_build_object('ok', false, 'error', 'not_awaiting_choice');
  end if;
  -- Idempotent: the same choice twice answers the same.
  if v_order.return_choice is not null then
    if v_order.return_choice = p_option then
      return jsonb_build_object('ok', true, 'already_chosen', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'choice_already_made');
  end if;
  if v_order.status <> 'preparing' then
    return jsonb_build_object('ok', false, 'error', 'not_awaiting_choice');
  end if;
  if v_order.return_choice_deadline <= now() then
    return jsonb_build_object('ok', false, 'error', 'choice_expired');
  end if;
  if p_option is null or p_option not in ('pickup', 'reschedule', 'refund') then
    return jsonb_build_object('ok', false, 'error', 'invalid_option');
  end if;

  if p_option = 'pickup' then
    -- Without a NIT, the cédula of who picks it up (D-067).
    if not exists (select 1 from public.customers where id = v_uid and document_type = 'nit') then
      if nullif(btrim(coalesce(p_pickup_document, '')), '') is null then
        return jsonb_build_object('ok', false, 'error', 'pickup_document_required');
      end if;
      v_digits := private.normalize_id_document(p_pickup_document);
      if v_digits is null then
        return jsonb_build_object('ok', false, 'error', 'invalid_pickup_document');
      end if;
      insert into private.order_pickup_documents (order_id, document_hash, document_last3)
      values (v_order.id, private.pickup_document_hash(v_order.id, v_digits), right(v_digits, 3))
      on conflict (order_id) do update
        set document_hash = excluded.document_hash, document_last3 = excluded.document_last3,
            failed_attempts = 0, updated_at = now();
    end if;
    update public.orders set fulfillment = 'pickup' where id = v_order.id;
  elsif p_option = 'reschedule' then
    -- Next day, without charging the delivery again (D-059).
    update public.orders set scheduled_delivery_on = private.bogota_tomorrow() where id = v_order.id;
  else
    -- Products only: the delivery was attempted (D-059).
    update public.orders
    set needs_refund = true, refund_reason = 'customer_chose_refund', refund_amount_cop = subtotal_cop
    where id = v_order.id;
    -- The bottles are back at the store and can be sold again (D-069).
    perform private.return_order_stock(v_order.id, 'Domicilio fallido: el cliente pidió el reembolso', v_uid);
  end if;

  update public.orders set return_choice = p_option, return_choice_at = now() where id = v_order.id;
  insert into public.order_events (order_id, from_status, to_status, actor_id, reason)
  values (v_order.id, v_order.status, v_order.status, v_uid,
          'El cliente eligió: ' || case p_option
            when 'pickup' then 'recoger en la tienda'
            when 'reschedule' then 'un nuevo envío mañana'
            else 'el reembolso de los productos' end);
  return jsonb_build_object('ok', true, 'already_chosen', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Recording a refund: products only now completes (replaces the D-068 version)
-- ---------------------------------------------------------------------------

create or replace function public.mark_order_refunded(p_order_id uuid, p_reference text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_invoice public.invoices;
  v_reference text := trim(coalesce(p_reference, ''));
  v_note text := trim(coalesce(p_note, ''));
  v_credit_note uuid;
begin
  perform private.require_admin();
  if length(v_reference) not between 3 and 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reference');
  end if;
  if length(v_note) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or not v_order.needs_refund then
    return jsonb_build_object('ok', false, 'error', 'order_not_refundable');
  end if;
  if v_order.refunded_at is not null then
    return jsonb_build_object('ok', true, 'already_refunded', true);
  end if;
  -- Any refund waits while the invoice is still being issued (as a POS void,
  -- D-053): otherwise Factus could accept it right after, with no credit
  -- note. "Being issued" means sent, or pending with its issue_invoice job
  -- still queued or running; a pending invoice whose job already ended
  -- (skipped, failed) does not block the refund forever, and a rejected one
  -- is final until someone retries it (retry_invoice makes it pending).
  select * into v_invoice from public.invoices where order_id = p_order_id for update;
  if v_invoice.status in ('pending', 'sent') and (
       v_invoice.status = 'sent'
       or exists (
         select 1 from public.actions a
         where a.idempotency_key = private.uuid_from_text('issue_invoice:' || p_order_id::text)
           and a.status in ('queued', 'processing')
       )
     ) then
    return jsonb_build_object('ok', false, 'error', 'invoice_in_progress', 'invoice_status', v_invoice.status);
  end if;

  update public.orders
  set refunded_at = now(), refunded_by = auth.uid(), refund_reference = v_reference, refund_note = v_note,
      -- A paid order, or one back at the store, becomes refunded; a
      -- cancelled one stays cancelled.
      status = case when status in ('paid', 'preparing') then 'refunded'::public.order_status else status end
  where id = p_order_id;

  -- That change is logged by the order history trigger; a cancelled order
  -- keeps its status, so the refund is logged here.
  if v_order.status not in ('paid', 'preparing') then
    insert into public.order_events (order_id, from_status, to_status, actor_id, reason)
    values (p_order_id, v_order.status, v_order.status, auth.uid(),
            'Reembolso registrado (' || v_reference || '): ' || v_note);
  end if;

  -- A whole refund annuls the invoice (concept 2); products only credits the
  -- product lines (concept 1), the delivery stays invoiced. A rejected
  -- invoice is not a valid document: no credit note.
  if v_invoice.status = 'accepted' then
    v_credit_note := private.request_credit_note_kind(
      v_invoice.id, 'Reembolso: ' || v_note,
      case when v_order.refund_amount_cop is not null then 'products_only' else 'full' end);
  end if;
  return jsonb_build_object('ok', true, 'already_refunded', false, 'credit_note_id', v_credit_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoices page: the kind of each credit note (replaces the D-057 version)
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_invoices()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'order_id', i.order_id, 'reference_code', i.reference_code, 'status', i.status,
        'total_cop', i.total_cop, 'last_error', i.last_error, 'dian_errors', i.dian_errors,
        'response_message', i.response ->> 'message', 'attempts', i.attempts,
        'updated_at', i.updated_at, 'channel', o.channel,
        'action_status', a.status, 'action_error', a.error
      ) order by i.updated_at desc)
      from public.invoices i
      join public.orders o on o.id = i.order_id
      left join public.actions a on a.idempotency_key = private.uuid_from_text('issue_invoice:' || i.order_id::text)
      where i.status <> 'accepted' and o.voided_at is null and not o.needs_refund
    ), '[]'::jsonb),
    'credit_notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'reference_code', n.reference_code, 'status', n.status, 'reason', n.reason,
        'kind', n.kind, 'concept_code', n.concept_code,
        'last_error', n.last_error, 'invoice_number', i.factus_number, 'created_at', n.created_at,
        'attempts', n.attempts, 'action_status', a.status, 'action_error', a.error
      ) order by n.created_at desc)
      from public.credit_notes n
      join public.invoices i on i.id = n.invoice_id
      left join public.actions a on a.idempotency_key = private.uuid_from_text('issue_credit_note:' || n.id::text)
      where n.status <> 'accepted'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function
  private.request_credit_note_kind(uuid, text, text),
  private.return_order_stock(uuid, text, uuid)
from public, anon, authenticated;
