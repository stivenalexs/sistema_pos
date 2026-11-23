-- One definition for each "needs attention" rule of the admin panel
-- (thermos quality finding 2, D-071; D-076).
--
-- The summary (admin_summary, the counters of the menu) and each list of the
-- panel wrote the same rule twice, and they drifted apart more than once
-- (D-055, D-057, D-068). The pickup limit of 5 attempts was a literal in six
-- functions. Now each rule lives once in the private schema, and both the
-- summary and the lists read it:
--
--   private.pickup_max_attempts() / private.pickup_locked(n)   limit of 5
--   private.pickups_needing_attention (view)                    locked or without cédula
--   private.invoices_in_play / private.credit_notes_in_play     not accepted, still invoiceable
--     (column needs_attention: rejected, or its job failed)
--   private.order_refund_pending(o) / private.attempt_refund_pending(pa)
--   private.delivery_awaiting_choice(o)                          customer must choose
--   private.action_overdue(a) / private.action_stalled(a)        worker not running
--
-- The functions below are replaced with the same signature and the same
-- answers; only where the rule comes from changes. The views and helpers are
-- in the private schema (not exposed by the API) and have no privileges for
-- the API roles; the SECURITY DEFINER functions that use them check the role
-- first, as before.
--
-- The small rules are SQL functions WITHOUT "set search_path": PostgreSQL
-- only inlines a SQL function into the calling query when it has no SET
-- clause, and inlined they can use the partial indexes (actions_open_idx,
-- payment_attempts_refund_pending_idx...). They read only fields of their
-- row argument and built-in operators and functions (pg_catalog is always
-- searched first), and call other functions fully qualified, so a
-- search_path cannot change what they do. The views run with the invoker's
-- rights (security_invoker): only the SECURITY DEFINER functions below read
-- them.
--
-- Corrected before its commit after an external review pasted by the owner
-- (D-076).
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- STABLE, not IMMUTABLE: PostgreSQL folds an immutable function into a
-- constant inside cached plans and does not invalidate them when the
-- function changes, so open connections would keep the old limit after a
-- migration. A stable SQL function is still inlined, and the plan records
-- the dependency.
create function private.pickup_max_attempts()
returns integer
language sql
stable
as $$
  select 5;
$$;

create function private.pickup_locked(p_failed_attempts integer)
returns boolean
language sql
stable
as $$
  select coalesce(p_failed_attempts, 0) >= private.pickup_max_attempts();
$$;

-- After a failed delivery caused by the customer or the place, the order
-- waits for the customer's choice (D-068).
create function private.delivery_awaiting_choice(p_order public.orders)
returns boolean
language sql
immutable
as $$
  select p_order.delivery_return_kind is not distinct from 'customer' and p_order.return_choice is null;
$$;

create function private.order_refund_pending(p_order public.orders)
returns boolean
language sql
immutable
as $$
  select p_order.needs_refund and p_order.refunded_at is null;
$$;

-- A duplicate payment: only that attempt's money goes back (D-072).
create function private.attempt_refund_pending(p_attempt public.payment_attempts)
returns boolean
language sql
immutable
as $$
  select p_attempt.refund_needed and p_attempt.refunded_at is null;
$$;

-- Due for more than 10 minutes without being taken: the worker is not running.
create function private.action_overdue(p_action public.actions)
returns boolean
language sql
stable
as $$
  select p_action.status = 'queued'
    and coalesce(p_action.next_attempt_at, p_action.created_at) < now() - interval '10 minutes';
$$;

-- Taken but not finished for more than 10 minutes.
create function private.action_stalled(p_action public.actions)
returns boolean
language sql
stable
as $$
  select p_action.status = 'processing' and p_action.updated_at < now() - interval '10 minutes';
$$;

-- Web pickups the store must resolve: locked after the wrong documents, or
-- without the cédula of whoever picks up (and no NIT to use instead). A
-- locked order is listed as locked even if it also lacks the cédula;
-- missing_document says that second fact on its own (get_pickup_status).
create view private.pickups_needing_attention with (security_invoker = true) as
  select
    o.id as order_id,
    o.status,
    c.full_name as customer_name,
    o.paid_at,
    o.total_cop,
    o.return_choice_defaulted,
    case when private.pickup_locked(d.failed_attempts) then 'locked' else 'missing_document' end as reason,
    coalesce(d.failed_attempts, 0) as failed_attempts,
    (d.document_hash is null and c.document_type is distinct from 'nit') as missing_document
  from public.orders o
  join public.customers c on c.id = o.customer_id
  left join private.order_pickup_documents d on d.order_id = o.id
  where o.channel = 'web' and o.fulfillment = 'pickup' and not o.needs_refund
    and o.status in ('paid', 'preparing')
    and not exists (select 1 from public.pickup_confirmations pc where pc.order_id = o.id)
    and (
      private.pickup_locked(d.failed_attempts)
      or (d.document_hash is null and c.document_type is distinct from 'nit')
    );

-- Invoices not accepted yet whose order is still invoiced: a voided POS sale
-- or an order to refund is no longer invoiced (D-057), so they never alert.
create view private.invoices_in_play with (security_invoker = true) as
  select
    i.id, i.order_id, i.reference_code, i.status, i.total_cop, i.last_error, i.dian_errors,
    i.response, i.attempts, i.updated_at, o.channel,
    a.status as action_status, a.error as action_error,
    (i.status = 'rejected' or a.status is not distinct from 'failed') as needs_attention
  from public.invoices i
  join public.orders o on o.id = i.order_id
  left join public.actions a on a.idempotency_key = private.uuid_from_text('issue_invoice:' || i.order_id::text)
  where i.status <> 'accepted' and o.voided_at is null and not o.needs_refund;

create view private.credit_notes_in_play with (security_invoker = true) as
  select
    n.id, n.reference_code, n.status, n.reason, n.kind, n.concept_code, n.last_error,
    i.factus_number as invoice_number, n.created_at, n.attempts,
    a.status as action_status, a.error as action_error,
    (n.status = 'rejected' or a.status is not distinct from 'failed') as needs_attention
  from public.credit_notes n
  join public.invoices i on i.id = n.invoice_id
  left join public.actions a on a.idempotency_key = private.uuid_from_text('issue_credit_note:' || n.id::text)
  where n.status <> 'accepted';

revoke all on function
  private.pickup_max_attempts(),
  private.pickup_locked(integer),
  private.delivery_awaiting_choice(public.orders),
  private.order_refund_pending(public.orders),
  private.attempt_refund_pending(public.payment_attempts),
  private.action_overdue(public.actions),
  private.action_stalled(public.actions)
from public, anon, authenticated;

revoke all on private.pickups_needing_attention, private.invoices_in_play, private.credit_notes_in_play
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------

-- Same answer as before (D-056 ... D-072); every rule now comes from above.
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
    'invoices_attention',
      (select count(*) from private.invoices_in_play where needs_attention)
      + (select count(*) from private.credit_notes_in_play where needs_attention),
    'failed_actions', (select count(*) from public.actions where status = 'failed'),
    'queue_stuck', (select count(*) from public.actions a
                    where private.action_overdue(a) or private.action_stalled(a)),
    'refunds_pending',
      (select count(*) from public.orders o where private.order_refund_pending(o))
      + (select count(*) from public.payment_attempts pa where private.attempt_refund_pending(pa)),
    'low_stock', (v_inventory ->> 'low_stock')::integer,
    'stock_mismatches', (v_inventory ->> 'stock_mismatches')::integer,
    'deliveries_to_assign', (
      select count(*) from public.orders o
      where o.channel = 'web' and o.fulfillment = 'delivery' and not o.needs_refund and o.status in ('paid', 'preparing')
        and not private.delivery_awaiting_choice(o)
    ),
    'deliveries_failed', (
      select count(*) from public.orders o
      where o.channel = 'web' and o.fulfillment = 'delivery' and not o.needs_refund and o.status = 'preparing'
        and private.delivery_awaiting_choice(o)
    ),
    'pickups_attention', (select count(*) from private.pickups_needing_attention)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Lists
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
        'updated_at', i.updated_at, 'channel', i.channel,
        'action_status', i.action_status, 'action_error', i.action_error
      ) order by i.updated_at desc)
      from private.invoices_in_play i
    ), '[]'::jsonb),
    'credit_notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'reference_code', n.reference_code, 'status', n.status, 'reason', n.reason,
        'kind', n.kind, 'concept_code', n.concept_code,
        'last_error', n.last_error, 'invoice_number', n.invoice_number, 'created_at', n.created_at,
        'attempts', n.attempts, 'action_status', n.action_status, 'action_error', n.action_error
      ) order by n.created_at desc)
      from private.credit_notes_in_play n
    ), '[]'::jsonb)
  );
end;
$$;

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
    where private.order_refund_pending(o)
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
    where private.attempt_refund_pending(pa)
    ) s
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_list_pickups_attention()
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
      'order_id', p.order_id,
      'status', p.status,
      'customer', p.customer_name,
      'paid_at', p.paid_at,
      'total_cop', p.total_cop,
      'reason', p.reason,
      'failed_attempts', p.failed_attempts,
      'defaulted', p.return_choice_defaulted
    ) order by p.paid_at nulls last, p.order_id)
    from private.pickups_needing_attention p
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_queue_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'failed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'type', a.type, 'error', a.error, 'attempts', a.attempts,
        'max_attempts', a.max_attempts, 'payload', a.payload, 'finished_at', a.finished_at
      ) order by a.finished_at desc)
      from (select * from public.actions where status = 'failed' order by finished_at desc limit 100) a
    ), '[]'::jsonb),
    'overdue', (select count(*) from public.actions a where private.action_overdue(a)),
    'stalled', (select count(*) from public.actions a where private.action_stalled(a)),
    'queued', (select count(*) from public.actions where status = 'queued'),
    'failed_count', (select count(*) from public.actions where status = 'failed')
  );
end;
$$;

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
          'awaiting_choice', private.delivery_awaiting_choice(o),
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

-- ---------------------------------------------------------------------------
-- Pickup (the limit of 5 attempts)
-- ---------------------------------------------------------------------------

create or replace function public.get_pickup_status(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'document_last3', d.document_last3,
    'locked', private.pickup_locked(d.failed_attempts),
    -- Only when set_pickup_document would accept it: the same rule as the
    -- panel's "without cédula" (private.pickups_needing_attention).
    'needs_document', exists (
      select 1 from private.pickups_needing_attention p where p.order_id = o.id and p.missing_document
    )
  )
  from public.orders o
  left join private.order_pickup_documents d on d.order_id = o.id
  where o.id = p_order_id
    and o.customer_id = (select auth.uid())
    and o.channel = 'web' and o.fulfillment = 'pickup';
$$;

-- Same as the current version (20261121000000_store_pickup.sql), with the
-- limit read from private.pickup_max_attempts().
create or replace function public.confirm_pickup(p_order_id uuid, p_document text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  if private.pickup_locked(v_doc.failed_attempts) then
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
      'attempts_left', greatest(private.pickup_max_attempts() - v_failed, 0)
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
