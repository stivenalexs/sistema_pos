-- Failed deliveries: back to the store, the customer's choice, rescheduling
-- and emails (plan step 18b-1, D-059, D-068).
--
-- A failed delivery attempt no longer leaves the order 'out_for_delivery'
-- (D-045): the courier brings it back to the store ('preparing', no
-- assignment) and, depending on the reason:
--   * customer or place (absent, inaccessible, no cédula, refused, other):
--     the customer has 3 days to choose pickup at the store, a new delivery
--     the next day (no new fee) or a refund of the products only; without a
--     choice the order stays for pickup;
--   * recipient under 18: marked for a refund of the products only;
--   * force majeure (accident, breakdown, weather or disaster): rescheduled
--     for the next day, for the administrator to assign again.
-- The customer is emailed in each case by the send_email action, queued in
-- the same transaction (D-017).
--
-- The refund of the products only is completed in step 18b-2 (partial credit
-- note); until then mark_order_refunded refuses partial refunds.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Failure reasons
-- ---------------------------------------------------------------------------

alter table public.delivery_attempts
  drop constraint delivery_attempts_failure_reason_check,
  add constraint delivery_attempts_failure_reason_check check (failure_reason in (
    'recipient_underage', 'no_id_document', 'recipient_absent', 'refused', 'other',
    'inaccessible_location',
    'courier_accident', 'vehicle_breakdown', 'weather_or_disaster', 'other_force_majeure'
  ));

-- 'customer' (customer or place), 'force_majeure' or 'underage'; null for an
-- unknown reason.
create function private.delivery_failure_kind(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_reason = 'recipient_underage' then 'underage'
    when p_reason in ('recipient_absent', 'inaccessible_location', 'no_id_document', 'refused', 'other')
      then 'customer'
    when p_reason in ('courier_accident', 'vehicle_breakdown', 'weather_or_disaster', 'other_force_majeure')
      then 'force_majeure'
  end;
$$;

-- Tomorrow in Colombia (no daylight saving time).
create function private.bogota_tomorrow()
returns date
language sql
stable
set search_path = ''
as $$
  select ((now() at time zone 'America/Bogota')::date + 1);
$$;

-- ---------------------------------------------------------------------------
-- Orders: return to the store and the customer's choice
-- ---------------------------------------------------------------------------

alter table public.orders
  add column delivery_return_kind text check (delivery_return_kind in ('customer', 'force_majeure', 'underage')),
  add column returned_at timestamptz,
  add column return_choice text check (return_choice in ('pickup', 'reschedule', 'refund')),
  add column return_choice_at timestamptz,
  add column return_choice_deadline timestamptz,
  -- The 3 days passed without a choice: pickup was applied (D-059).
  add column return_choice_defaulted boolean not null default false,
  -- Day (Colombia) a rescheduled delivery should go out.
  add column scheduled_delivery_on date,
  -- Amount to return when it is not the whole order (products only).
  add column refund_amount_cop bigint check (refund_amount_cop > 0),
  add constraint orders_return_kind_pair_check check ((delivery_return_kind is null) = (returned_at is null)),
  add constraint orders_return_choice_pair_check check ((return_choice is null) = (return_choice_at is null)),
  add constraint orders_return_choice_kind_check check (return_choice is null or delivery_return_kind = 'customer'),
  -- Only a customer-side return has a deadline, and the default is always pickup.
  add constraint orders_return_deadline_check check (
    (return_choice_deadline is not null) = (delivery_return_kind is not distinct from 'customer')
  ),
  add constraint orders_return_defaulted_check check (not return_choice_defaulted or return_choice = 'pickup'),
  add constraint orders_refund_amount_needs_refund_check check (
    refund_amount_cop is null or (needs_refund and refund_amount_cop <= total_cop)
  );

create index orders_awaiting_choice_idx on public.orders (return_choice_deadline)
  where delivery_return_kind = 'customer' and return_choice is null;

-- An order waiting for the customer's choice is not assigned again.
create function private.block_assign_awaiting_choice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'out_for_delivery' and old.status is distinct from 'out_for_delivery'
     and new.delivery_return_kind = 'customer' and new.return_choice is distinct from 'reschedule' then
    raise exception 'delivery_awaiting_customer_choice' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger block_assign_awaiting_choice
  before update of status on public.orders
  for each row execute function private.block_assign_awaiting_choice();

-- Queues an email to the order's customer (worker: send_email). The key is
-- derived from the template and a unique event, so it is never sent twice
-- for the same event (D-034: at least once, retried with backoff).
create function private.enqueue_order_email(p_template text, p_order_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_action(
    private.uuid_from_text('send_email:' || p_template || ':' || p_event),
    'send_email',
    null,
    jsonb_build_object('template', p_template, 'order_id', p_order_id),
    8
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Order history with actor and reason (replaces the D-055 version)
-- ---------------------------------------------------------------------------

-- The worker and pg_cron run without a user session, so auth.uid() is null.
-- Functions that change an order on someone's behalf set, for their own
-- transaction, app.order_event_actor and app.order_event_reason; the history
-- uses them when there is no session or no reason of its own.
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
      coalesce(auth.uid(), nullif(current_setting('app.order_event_actor', true), '')::uuid),
      coalesce(
        case new.status
          when 'cancelled' then new.cancel_reason
          when 'refunded' then coalesce(
            new.void_reason,
            case when new.refund_reference is not null
                 then 'Reembolso registrado (' || new.refund_reference || '): ' || new.refund_note end,
            new.refund_reason)
        end,
        nullif(current_setting('app.order_event_reason', true), '')
      )
    );
  end if;
  return null;
end;
$$;

create function private.set_order_event_context(p_actor uuid, p_reason text)
returns void
language sql
set search_path = ''
as $$
  select set_config('app.order_event_actor', coalesce(p_actor::text, ''), true),
         set_config('app.order_event_reason', coalesce(p_reason, ''), true);
$$;

-- ---------------------------------------------------------------------------
-- Recording an attempt (replaces the D-045 version; same answers)
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

-- ---------------------------------------------------------------------------
-- The customer's choice
-- ---------------------------------------------------------------------------

-- Answers {"ok": true, "already_chosen": bool} or {"ok": false, "error":
-- "order_not_found"|"not_awaiting_choice"|"choice_already_made"|"choice_expired"
-- |"invalid_option"|"pickup_document_required"|"invalid_pickup_document"}
create function public.choose_delivery_return_option(
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

-- Without a choice in 3 days the order stays for pickup at the store (D-059).
-- pg_cron, every 5 minutes (the order page already says the time is over).
create function public.apply_expired_return_choices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.orders
    set return_choice = 'pickup', return_choice_at = now(), return_choice_defaulted = true,
        fulfillment = 'pickup'
    where delivery_return_kind = 'customer' and return_choice is null
      and return_choice_deadline <= now() and status = 'preparing'
    returning id, status
  ), logged as (
    insert into public.order_events (order_id, from_status, to_status, actor_id, reason)
    select id, status, status, null, 'Sin elección del cliente en 3 días: queda para recoger en la tienda'
    from expired
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end;
$$;

select cron.schedule(
  'apply-expired-return-choices',
  '*/5 * * * *',
  'select public.apply_expired_return_choices()'
);

-- ---------------------------------------------------------------------------
-- Pickups to resolve (D-067)
-- ---------------------------------------------------------------------------

-- Replaces the step 18a version: also says whether the customer must still
-- give the cédula (orders placed before 18a, or turned into pickup without one).
create or replace function public.get_pickup_status(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'document_last3', d.document_last3,
    'locked', coalesce(d.failed_attempts, 0) >= 5,
    -- Only when set_pickup_document would accept it.
    'needs_document', d.document_hash is null
      and o.status in ('paid', 'preparing') and not o.needs_refund
      and not exists (select 1 from public.pickup_confirmations pc where pc.order_id = o.id)
      and not exists (select 1 from public.customers c where c.id = o.customer_id and c.document_type = 'nit')
  )
  from public.orders o
  left join private.order_pickup_documents d on d.order_id = o.id
  where o.id = p_order_id
    and o.customer_id = (select auth.uid())
    and o.channel = 'web' and o.fulfillment = 'pickup';
$$;

-- The customer gives the cédula once, for a pickup order that has none.
-- Answers {"ok": true, "document_last3"} or {"ok": false, "error":
-- "order_not_found"|"pickup_not_available"|"document_already_set"|"not_needed"
-- |"invalid_pickup_document"}
create function public.set_pickup_document(p_order_id uuid, p_document text)
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
    raise exception 'pickup_requires_customer' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  if v_order.channel <> 'web' or v_order.fulfillment <> 'pickup'
     or v_order.status not in ('paid', 'preparing') or v_order.needs_refund
     or exists (select 1 from public.pickup_confirmations where order_id = p_order_id) then
    return jsonb_build_object('ok', false, 'error', 'pickup_not_available');
  end if;
  if exists (select 1 from public.customers where id = v_uid and document_type = 'nit') then
    return jsonb_build_object('ok', false, 'error', 'not_needed');
  end if;
  if exists (select 1 from private.order_pickup_documents where order_id = p_order_id and document_hash is not null) then
    return jsonb_build_object('ok', false, 'error', 'document_already_set');
  end if;
  v_digits := private.normalize_id_document(p_document);
  if v_digits is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_pickup_document');
  end if;
  insert into private.order_pickup_documents (order_id, document_hash, document_last3)
  values (v_order.id, private.pickup_document_hash(v_order.id, v_digits), right(v_digits, 3))
  on conflict (order_id) do update
    set document_hash = excluded.document_hash, document_last3 = excluded.document_last3, updated_at = now();
  return jsonb_build_object('ok', true, 'document_last3', right(v_digits, 3));
end;
$$;

-- The administrator unlocks a pickup after five wrong documents, with a
-- reason kept in the order history. The customer confirms again.
create function public.admin_reset_pickup_attempts(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
  v_order public.orders;
begin
  perform private.require_admin();
  if length(v_reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.channel <> 'web' or v_order.fulfillment <> 'pickup' then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  update private.order_pickup_documents set failed_attempts = 0, updated_at = now()
  where order_id = p_order_id and failed_attempts > 0;
  if not found then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  insert into public.order_events (order_id, from_status, to_status, actor_id, reason)
  values (p_order_id, v_order.status, v_order.status, auth.uid(),
          'Intentos de recogida reiniciados: ' || v_reason);
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds: partial ones wait for step 18b-2 (replaces the D-055 version)
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
  -- Products only (D-059), even when the delivery was free and the amount
  -- equals the total: needs a partial credit note and the stock back, which
  -- arrive in step 18b-2. Never annul the whole invoice for it.
  if v_order.refund_amount_cop is not null then
    return jsonb_build_object('ok', false, 'error', 'partial_refund_pending');
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

  -- Orders to refund are not invoiced (D-044); if one was, ask for its note.
  select * into v_invoice from public.invoices where order_id = p_order_id;
  if v_invoice.status = 'accepted' then
    v_credit_note := public.request_credit_note(v_invoice.id, 'Reembolso: ' || v_note);
  end if;
  return jsonb_build_object('ok', true, 'already_refunded', false, 'credit_note_id', v_credit_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Panel reads
-- ---------------------------------------------------------------------------

-- Replaces the D-057 version: also the return to the store and rescheduling.
-- Orders waiting for the customer's choice are listed apart (not assignable).
create or replace function public.admin_list_deliveries()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    -- Unassigned first, then the earliest scheduled day, then the oldest payment.
    select jsonb_agg(row_data order by is_assigned, scheduled_on nulls first, paid_ts, order_id)
    from (
      select
        o.status = 'out_for_delivery' as is_assigned,
        o.scheduled_delivery_on as scheduled_on,
        coalesce(o.paid_at, o.created_at) as paid_ts,
        o.id as order_id,
        jsonb_build_object(
          'order_id', o.id,
          'status', o.status,
          'paid_at', o.paid_at,
          'total_cop', o.total_cop,
          'total_units', o.total_base_units,
          'municipality', o.delivery_address ->> 'municipality',
          'address_line', o.delivery_address ->> 'address_line',
          'details', o.delivery_address ->> 'details',
          'contact_name', o.delivery_address ->> 'contact_name',
          'contact_phone', o.delivery_address ->> 'contact_phone',
          'distance_m', o.delivery_distance_m,
          'provider_id', o.delivery_provider_id,
          'provider', p.name,
          'provider_kind', p.kind,
          'courier_id', o.courier_id,
          'courier', cr.full_name,
          'external_ref', o.delivery_external_ref,
          'assigned_at', o.assigned_at,
          'return_kind', o.delivery_return_kind,
          'returned_at', o.returned_at,
          'return_choice', o.return_choice,
          'return_choice_deadline', o.return_choice_deadline,
          'awaiting_choice', o.delivery_return_kind is not distinct from 'customer' and o.return_choice is null,
          'scheduled_delivery_on', o.scheduled_delivery_on,
          'last_failure', (
            select jsonb_build_object('reason', a.failure_reason, 'notes', a.notes, 'at', a.created_at)
            from public.delivery_attempts a
            where a.order_id = o.id and a.outcome = 'failed'
              -- Only with the current assignment: a reassignment starts over.
              and (o.assigned_at is null or a.created_at >= o.assigned_at)
            order by a.created_at desc limit 1
          )
        ) as row_data
      from public.orders o
      left join public.delivery_providers p on p.id = o.delivery_provider_id
      left join public.couriers cr on cr.id = o.courier_id
      where o.channel = 'web' and o.fulfillment = 'delivery' and not o.needs_refund
        and o.status in ('paid', 'preparing', 'out_for_delivery')
    ) s
  ), '[]'::jsonb);
end;
$$;

-- Refunds list (replaces the D-055 version): also the amount to return when
-- it is only the products (D-068).
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
    select jsonb_agg(jsonb_build_object(
      'order_id', o.id, 'status', o.status, 'total_cop', o.total_cop, 'refund_reason', o.refund_reason,
      'refund_amount_cop', coalesce(o.refund_amount_cop, o.total_cop),
      'products_only', o.refund_amount_cop is not null,
      'paid_at', o.paid_at, 'customer', coalesce(c.full_name, 'Cliente'), 'email', u.email,
      'transaction_id', (select a.wompi_transaction_id from public.payment_attempts a
                         where a.order_id = o.id and a.status = 'approved' order by a.finalized_at desc limit 1)
    ) order by o.updated_at)
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join auth.users u on u.id = o.customer_id
    where o.needs_refund and o.refunded_at is null
  ), '[]'::jsonb);
end;
$$;

-- Pickup orders the store must resolve: locked after five wrong documents,
-- or without a cédula yet (the customer can still give it).
create function public.admin_list_pickups_attention()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_id', o.id,
      'status', o.status,
      'customer', c.full_name,
      'paid_at', o.paid_at,
      'total_cop', o.total_cop,
      'reason', case when coalesce(d.failed_attempts, 0) >= 5 then 'locked' else 'missing_document' end,
      'failed_attempts', coalesce(d.failed_attempts, 0),
      'defaulted', o.return_choice_defaulted
    ) order by o.paid_at nulls last, o.id)
    from public.orders o
    join public.customers c on c.id = o.customer_id
    left join private.order_pickup_documents d on d.order_id = o.id
    where o.channel = 'web' and o.fulfillment = 'pickup' and not o.needs_refund
      and o.status in ('paid', 'preparing')
      and not exists (select 1 from public.pickup_confirmations pc where pc.order_id = o.id)
      and (
        coalesce(d.failed_attempts, 0) >= 5
        or (d.document_hash is null and c.document_type is distinct from 'nit')
      )
  ), '[]'::jsonb);
end;
$$;

-- Panel home (replaces the D-057 version). A failed delivery now returns to
-- the store, so 'deliveries_failed' counts orders waiting for the customer's
-- choice; 'deliveries_to_assign' leaves them out; 'pickups_attention' is new.
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
    'refunds_pending', (select count(*) from public.orders where needs_refund and refunded_at is null),
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

-- ---------------------------------------------------------------------------
-- Email data for the worker (server only)
-- ---------------------------------------------------------------------------

-- What the send_email worker needs: the customer's address and name and the
-- facts of the order. Never the cédula.
create function public.order_email_data(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'email', u.email,
    'customer_name', c.full_name,
    'status', o.status,
    'fulfillment', o.fulfillment,
    'subtotal_cop', o.subtotal_cop,
    'delivery_fee_cop', o.delivery_fee_cop,
    'total_cop', o.total_cop,
    'refund_amount_cop', o.refund_amount_cop,
    'return_kind', o.delivery_return_kind,
    'return_choice_deadline', o.return_choice_deadline,
    'scheduled_delivery_on', o.scheduled_delivery_on,
    'address_line', o.delivery_address ->> 'address_line',
    'municipality', o.delivery_address ->> 'municipality',
    'failure_reason', (
      select a.failure_reason from public.delivery_attempts a
      where a.order_id = o.id and a.outcome = 'failed'
      order by a.created_at desc limit 1
    )
  )
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join auth.users u on u.id = o.customer_id
  where o.id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.set_order_event_context(uuid, text),
  private.delivery_failure_kind(text),
  private.bogota_tomorrow(),
  private.block_assign_awaiting_choice(),
  private.enqueue_order_email(text, uuid, text),
  public.choose_delivery_return_option(uuid, text, text),
  public.apply_expired_return_choices(),
  public.get_pickup_status(uuid),
  public.set_pickup_document(uuid, text),
  public.admin_reset_pickup_attempts(uuid, text),
  public.admin_list_pickups_attention(),
  public.order_email_data(uuid)
from public, anon, authenticated;

grant execute on function
  public.choose_delivery_return_option(uuid, text, text),
  public.get_pickup_status(uuid),
  public.set_pickup_document(uuid, text),
  public.admin_reset_pickup_attempts(uuid, text),
  public.admin_list_pickups_attention()
to authenticated;

grant execute on function
  public.apply_expired_return_choices(),
  public.order_email_data(uuid)
to service_role;
