-- The recipient's ID document leaves the queue, and a POS void no longer
-- waits forever (thermos findings, D-071; fixes in D-074).
--
-- 1. confirm_delivery (D-045) carries the recipient's name and ID document
--    in actions.payload, because the worker needs them to record the proof.
--    The proof itself lives in delivery_proofs, which only the administrator
--    reads; the copy in actions stayed in plain text forever, readable by
--    the courier who sent it and by every administrator, against the data
--    minimization of D-045 and D-067. Now a trigger strips both fields as
--    soon as the action ends ('succeeded' or 'failed'), and the actions
--    that already ended are cleaned now.
--    Consequence: a FAILED confirm_delivery of a delivered order can no
--    longer be retried from the admin panel (retry_action, D-055), because
--    the document is gone; retry_action now refuses it
--    (delivery_proof_data_removed) and the courier sends the confirmation
--    again (a new intent, a new key). A failed attempt (outcome 'failed')
--    never carried a document and can still be retried.
--
-- 2. void_pos_sale (D-053) waited ('invoice_in_progress') for any 'pending'
--    invoice, also one whose issue_invoice job had already ended (failed or
--    skipped): that sale could never be voided. It now uses the same guard
--    as mark_order_refunded (D-069): wait only while the invoice is 'sent',
--    or 'pending' with its job still queued or processing. It also takes
--    each product's stock lock before its return movement, like every other
--    inventory function (D-038, D-069).
--
-- Corrected before its commit after an external review pasted by the owner
-- (D-074).
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- 1. confirm_delivery payload
-- ---------------------------------------------------------------------------

-- Fields of a confirm_delivery payload that identify the recipient. They are
-- needed only until the worker records the proof.
create function private.strip_delivery_identity(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_payload - 'document_number' - 'recipient_name';
$$;

create function private.strip_ended_delivery_payload()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'confirm_delivery'
     and new.status in ('succeeded', 'failed') then
    new.payload := private.strip_delivery_identity(new.payload);
  end if;
  return new;
end;
$$;

-- On insert too: an action created already ended never keeps the document.
create trigger strip_ended_delivery_payload
  before insert or update of status on public.actions
  for each row execute function private.strip_ended_delivery_payload();

revoke all on function private.strip_delivery_identity(jsonb) from public;
revoke all on function private.strip_ended_delivery_payload() from public;

-- retry_action (D-055) refuses a delivered confirmation whose document was
-- removed: requeued, it could only fail again. Same as in
-- 20261108050000_admin_invoices_queue_refunds.sql otherwise.
create or replace function public.retry_action(p_action_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if exists (
    select 1 from public.actions
    where id = p_action_id
      and type = 'confirm_delivery'
      and payload ->> 'outcome' = 'delivered'
      and not (payload ? 'document_number' and payload ? 'recipient_name')
  ) then
    return jsonb_build_object('ok', false, 'error', 'delivery_proof_data_removed');
  end if;
  return private.requeue_action(p_action_id, p_reason);
end;
$$;

-- Actions that already ended.
update public.actions
set payload = private.strip_delivery_identity(payload)
where type = 'confirm_delivery'
  and status in ('succeeded', 'failed')
  and (payload ? 'document_number' or payload ? 'recipient_name');

-- ---------------------------------------------------------------------------
-- 2. void_pos_sale
-- ---------------------------------------------------------------------------

-- Same as in 20261108030000_pos_sales.sql, except the guard on the invoice.
create or replace function public.void_pos_sale(p_order_id uuid, p_reason text)
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

  -- The invoice is being issued: sent, or pending with its issue_invoice job
  -- still queued or running (same guard as mark_order_refunded, D-069).
  -- Voiding now could leave an invoice accepted right after, with no credit
  -- note. A pending invoice whose job already ended does not block the void
  -- forever; prepare_invoice refuses to send it once the sale is voided.
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

  for v_item in select * from public.order_items where order_id = p_order_id order by product_id
  loop
    perform private.lock_stock(v_item.product_id);
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

revoke all on function public.void_pos_sale(uuid, text) from public, anon;
grant execute on function public.void_pos_sale(uuid, text) to authenticated;
