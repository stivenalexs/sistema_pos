-- Admin panel, part B (plan step 17b, D-055): rejected invoices, credit
-- notes, the stuck queue and refunds.
--
-- - retry_action: a failed action goes back to the queue (handlers are
--   idempotent, D-034), with an insert-only history of who retried and why.
-- - retry_invoice / retry_credit_note: an invoice or credit note that is not
--   accepted and whose action failed (DIAN rejection, numbering range,
--   pending at Factus) is sent again with the SAME reference (D-044). The
--   invoice of a voided POS sale or of an order to refund is never retried.
-- - mark_order_refunded: the administrator returns the money in the Wompi
--   dashboard (no Wompi refund API) and records it here.
-- - Queue health: actions due or processing for more than 10 minutes mean
--   the worker is not running.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Retry history and refund data
-- ---------------------------------------------------------------------------

create table public.action_retries (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.actions (id) on delete cascade,
  action_type text not null,
  previous_error text,
  reason text not null check (length(trim(reason)) between 3 and 300),
  retried_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index action_retries_action_idx on public.action_retries (action_id, created_at desc);

create trigger action_retries_insert_only before update or delete on public.action_retries
  for each row execute function private.forbid_change();

revoke all on public.action_retries from anon, authenticated;
grant select on public.action_retries to authenticated;
alter table public.action_retries enable row level security;
create policy "action_retries: admin reads" on public.action_retries for select to authenticated
  using ((select private.has_staff_role(array['admin'])));

alter table public.orders
  add column refunded_at timestamptz,
  add column refunded_by uuid references auth.users (id) on delete set null,
  add column refund_reference text check (refund_reference is null or length(trim(refund_reference)) between 3 and 120),
  add column refund_note text check (refund_note is null or length(trim(refund_note)) between 3 and 300),
  add constraint orders_refunded_check check (
    (refunded_at is null) = (refund_reference is null)
    and (refunded_at is null) = (refund_note is null)
    and (refunded_at is null or needs_refund)
  );

-- Order history: a recorded refund keeps its reference and note (the void
-- reason of a POS sale and the refund flag reason as before, D-053).
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
        when 'refunded' then coalesce(
          new.void_reason,
          case when new.refund_reference is not null
               then 'Reembolso registrado (' || new.refund_reference || '): ' || new.refund_note end,
          new.refund_reason)
      end
    );
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retries
-- ---------------------------------------------------------------------------

-- The action with the given idempotency key (derived keys of the invoice and
-- credit note jobs), or null.
create function private.action_id_by_key(p_key uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.actions where idempotency_key = p_key;
$$;

-- Puts a failed action back in the queue. Returns {"ok": true} or {"ok":
-- false, "error": action_not_found | action_not_failed | invalid_reason}.
create function private.requeue_action(p_action_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.actions;
  v_reason text := trim(coalesce(p_reason, ''));
  v_msg_id bigint;
begin
  if length(v_reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;
  select * into v_action from public.actions where id = p_action_id for update;
  if v_action.id is null then
    return jsonb_build_object('ok', false, 'error', 'action_not_found');
  end if;
  if v_action.status <> 'failed' then
    return jsonb_build_object('ok', false, 'error', 'action_not_failed', 'status', v_action.status);
  end if;

  select pgmq.send('actions', jsonb_build_object('action_id', v_action.id)) into v_msg_id;
  update public.actions
  set status = 'queued', attempts = 0, error = null, result = null,
      next_attempt_at = null, started_at = null, finished_at = null, queue_msg_id = v_msg_id
  where id = v_action.id;

  insert into public.action_retries (action_id, action_type, previous_error, reason, retried_by)
  values (v_action.id, v_action.type, v_action.error, v_reason, auth.uid());
  return jsonb_build_object('ok', true, 'action_id', v_action.id);
end;
$$;

create function public.retry_action(p_action_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.requeue_action(p_action_id, p_reason);
end;
$$;

-- Sends a not-accepted invoice again (same reference_code) once its action
-- failed. Returns {"ok": true} or {"ok": false, "error": invoice_not_found |
-- invoice_accepted | order_not_invoiceable | action_not_failed | ...}.
create function public.retry_invoice(p_invoice_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_order public.orders;
  v_result jsonb;
  v_action_id uuid;
begin
  perform private.require_admin();
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    return jsonb_build_object('ok', false, 'error', 'invoice_not_found');
  end if;
  if v_invoice.status = 'accepted' then
    return jsonb_build_object('ok', false, 'error', 'invoice_accepted');
  end if;
  select * into v_order from public.orders where id = v_invoice.order_id;
  if v_order.voided_at is not null or v_order.needs_refund then
    return jsonb_build_object('ok', false, 'error', 'order_not_invoiceable');
  end if;

  v_result := private.requeue_action(
    private.action_id_by_key(private.uuid_from_text('issue_invoice:' || v_invoice.order_id::text)), p_reason);
  if v_result ->> 'error' = 'action_not_found' then
    -- Defensive: the action should exist. Issue it with the same derived
    -- key the trigger uses, so the panel and later retries find it.
    select tracking_id into v_action_id from public.enqueue_action(
      private.uuid_from_text('issue_invoice:' || v_invoice.order_id::text), 'issue_invoice', null,
      jsonb_build_object('order_id', v_invoice.order_id), 8);
    insert into public.action_retries (action_id, action_type, previous_error, reason, retried_by)
    values (v_action_id, 'issue_invoice', 'action_not_found', trim(p_reason), auth.uid());
  elsif not (v_result ->> 'ok')::boolean then
    return v_result;
  end if;

  update public.invoices set status = 'pending', last_error = null where id = p_invoice_id;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.retry_credit_note(p_credit_note_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note public.credit_notes;
  v_result jsonb;
begin
  perform private.require_admin();
  select * into v_note from public.credit_notes where id = p_credit_note_id for update;
  if v_note.id is null then
    return jsonb_build_object('ok', false, 'error', 'credit_note_not_found');
  end if;
  if v_note.status = 'accepted' then
    return jsonb_build_object('ok', false, 'error', 'credit_note_accepted');
  end if;
  v_result := private.requeue_action(
    private.action_id_by_key(private.uuid_from_text('issue_credit_note:' || v_note.id::text)), p_reason);
  if not (v_result ->> 'ok')::boolean then
    return v_result;
  end if;
  update public.credit_notes set status = 'pending', last_error = null where id = p_credit_note_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds (recorded; the money is returned in the Wompi dashboard)
-- ---------------------------------------------------------------------------

create function public.mark_order_refunded(p_order_id uuid, p_reference text, p_note text)
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

  update public.orders
  set refunded_at = now(), refunded_by = auth.uid(), refund_reference = v_reference, refund_note = v_note,
      -- A paid order becomes refunded; a cancelled one stays cancelled.
      status = case when status = 'paid' then 'refunded'::public.order_status else status end
  where id = p_order_id;

  -- paid -> refunded is logged by the order history trigger; a cancelled
  -- order keeps its status, so the refund is logged here.
  if v_order.status <> 'paid' then
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

-- Invoices and credit notes that need attention (not accepted), with the
-- reason and the state of their action.
create function public.admin_list_invoices()
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
      where i.status <> 'accepted'
    ), '[]'::jsonb),
    'credit_notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'reference_code', n.reference_code, 'status', n.status, 'reason', n.reason,
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

-- Failed actions and the queue health.
create function public.admin_queue_status()
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
    -- Due for more than 10 minutes without being taken: the worker is not running.
    'overdue', (select count(*) from public.actions
                where status = 'queued' and coalesce(next_attempt_at, created_at) < now() - interval '10 minutes'),
    -- Taken but not finished for more than 10 minutes.
    'stalled', (select count(*) from public.actions
                where status = 'processing' and updated_at < now() - interval '10 minutes'),
    'queued', (select count(*) from public.actions where status = 'queued'),
    'failed_count', (select count(*) from public.actions where status = 'failed')
  );
end;
$$;

-- Orders whose money must be returned, not yet recorded as refunded.
create function public.admin_list_refunds()
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

-- Panel home: also invoices, queue and refunds.
create or replace function public.admin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'pending_wholesale', (select count(*) from public.customers where wholesale_status = 'pending'),
    'staff', (select count(*) from auth.users where raw_app_meta_data ? 'staff_role' and email_confirmed_at is not null),
    'pending_invitations', (select count(*) from public.staff_invitations where status = 'pending' and expires_at > now()),
    -- Not accepted and waiting for the administrator: rejected, or its job stopped.
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
    'refunds_pending', (select count(*) from public.orders where needs_refund and refunded_at is null)
  );
end;
$$;

revoke all on function private.requeue_action(uuid, text), private.action_id_by_key(uuid) from public;

revoke all on function
  public.retry_action(uuid, text),
  public.retry_invoice(uuid, text),
  public.retry_credit_note(uuid, text),
  public.mark_order_refunded(uuid, text, text),
  public.admin_list_invoices(),
  public.admin_queue_status(),
  public.admin_list_refunds()
from public, anon, authenticated;

-- Each checks the admin role inside.
grant execute on function
  public.retry_action(uuid, text),
  public.retry_invoice(uuid, text),
  public.retry_credit_note(uuid, text),
  public.mark_order_refunded(uuid, text, text),
  public.admin_list_invoices(),
  public.admin_queue_status(),
  public.admin_list_refunds()
to authenticated;
