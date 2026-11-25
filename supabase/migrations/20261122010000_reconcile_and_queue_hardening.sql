-- Reconciliation that cannot be clogged, and a queue that does not run an
-- action twice (thermos findings, D-071; fixes in D-073).
--
-- 1. Reconciliation (D-040). A customer can store any ?id= hint on their own
--    order. Wompi answers 404 for an invented one, and before this migration
--    that hint was never dropped; the job always took the 50 oldest pending
--    attempts, so 50 fake hints left real payments unreconciled forever.
--    Now:
--    - payments_to_reconcile hands out attempts by turns
--      (last_reconciled_at, oldest first) and stamps the ones it returns;
--    - attempts that only carry a browser hint and whose order closed more
--      than 48 hours ago are closed ('abandoned') instead of asked about
--      forever (a later payment on them is still caught, D-072);
--    - clear_unknown_payment_hint drops a hint that Wompi does not know
--      (404 NOT_FOUND_ERROR). A confirmed wompi_transaction_id is never
--      dropped. It and clear_mismatched_payment_hint close the attempt when
--      its order no longer waits for a payment.
--
-- 2. Queue (D-034). A message reappears when its visibility ends, and
--    claim_actions took again an action still 'processing' (a slow worker,
--    not a dead one): the handler ran twice, and the second worker's
--    fail_action could put back in the queue, or fail, an action that the
--    first one finished. Now an action that started less than 10 minutes
--    ago is not claimed again: its message stays hidden for the visibility
--    that pgmq.read just gave it. After 10 minutes the worker is taken as
--    dead and the action is claimed as before (it counts as an attempt).
--    Skipped messages no longer shorten the batch: claim_actions keeps
--    reading until it has p_batch actions or the queue has no visible
--    message, so a worker that claims one at a time does not stop early.
--
-- Corrected before its commit after an external review pasted by the owner
-- (D-073).
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- 1. Reconciliation
-- ---------------------------------------------------------------------------

alter table public.payment_attempts
  add column last_reconciled_at timestamptz;

create index payment_attempts_reconcile_idx
  on public.payment_attempts (last_reconciled_at nulls first, created_at, id)
  where status = 'pending';

-- Same signature and result as in 20261107182357_payments_wompi.sql. It now
-- writes:
-- - attempts with only a browser hint whose order closed more than 48 hours
--   ago are closed: nothing left to save, and an open one would keep the
--   10-minute job calling the app for nothing. The 48 hours leave room for
--   a late PSE payment on an order cancelled at 24 hours (D-039);
-- - each returned attempt is stamped, so the next run starts with the ones
--   asked about the longest ago (or never). Two runs at once do not take the
--   same rows (skip locked).
create or replace function public.payments_to_reconcile(p_min_age_minutes integer default 15, p_limit integer default 50)
returns table (attempt_id uuid, transaction_id text)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.payment_attempts pa
  set status = 'abandoned', finalized_at = now()
  from public.orders o
  where o.id = pa.order_id
    and pa.status = 'pending'
    and pa.wompi_transaction_id is null
    and o.status <> 'awaiting_payment'
    and coalesce(o.cancelled_at, o.paid_at, o.created_at) < now() - interval '48 hours';

  with picked as (
    select pa.id
    from public.payment_attempts pa
    where pa.status = 'pending'
      and coalesce(pa.wompi_transaction_id, pa.transaction_id_hint) is not null
      and pa.created_at <= now() - make_interval(mins => p_min_age_minutes)
    order by pa.last_reconciled_at nulls first, pa.created_at, pa.id
    limit greatest(coalesce(p_limit, 50), 0)
    for update of pa skip locked
  )
  update public.payment_attempts pa
  set last_reconciled_at = now()
  from picked
  where pa.id = picked.id
  returning pa.id, coalesce(pa.wompi_transaction_id, pa.transaction_id_hint);
$$;

-- Closes an attempt left without hint nor transaction when its order no
-- longer waits for a payment (cancelled, paid with another attempt,
-- refunded...). A later payment on it is still caught (D-072).
create function private.close_attempt_without_payment(p_attempt_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_attempts pa
  set status = 'abandoned', finalized_at = now()
  from public.orders o
  where pa.id = p_attempt_id
    and o.id = pa.order_id
    and o.status <> 'awaiting_payment'
    and pa.status = 'pending'
    and pa.wompi_transaction_id is null
    and pa.transaction_id_hint is null;
$$;

revoke all on function private.close_attempt_without_payment(uuid) from public;

-- Wompi does not know the transaction of this hint (404 NOT_FOUND_ERROR):
-- the hint is dropped, and the attempt is closed if its order no longer
-- waits for a payment. Returns true if the hint was dropped.
create function public.clear_unknown_payment_hint(p_attempt_id uuid, p_transaction_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payment_attempts
  set transaction_id_hint = null
  where id = p_attempt_id
    and transaction_id_hint = p_transaction_id
    and wompi_transaction_id is null;
  if not found then
    return false;
  end if;
  perform private.close_attempt_without_payment(p_attempt_id);
  return true;
end;
$$;

-- Same as in 20261107220619_clear_mismatched_payment_hint.sql, plus closing
-- the attempt when its order no longer waits for a payment.
create or replace function public.clear_mismatched_payment_hint(
  p_attempt_id uuid,
  p_transaction_id text,
  p_wompi_reference text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payment_attempts
  set transaction_id_hint = null
  where id = p_attempt_id
    and transaction_id_hint = p_transaction_id
    and reference is distinct from p_wompi_reference;
  if not found then
    return false;
  end if;
  perform private.close_attempt_without_payment(p_attempt_id);
  return true;
end;
$$;

revoke all on function public.payments_to_reconcile(integer, integer) from public, anon, authenticated;
grant execute on function public.payments_to_reconcile(integer, integer) to service_role;
revoke all on function public.clear_unknown_payment_hint(uuid, text) from public, anon, authenticated;
grant execute on function public.clear_unknown_payment_hint(uuid, text) to service_role;
revoke all on function public.clear_mismatched_payment_hint(uuid, text, text) from public, anon, authenticated;
grant execute on function public.clear_mismatched_payment_hint(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Queue
-- ---------------------------------------------------------------------------

-- Same signature and result as in 20261107055805_actions_queue.sql, plus the
-- guard for actions still being processed, and reading again while skipped
-- messages leave the batch short.
create or replace function public.claim_actions(
  p_batch integer default 10,
  p_visibility_seconds integer default 60
)
returns table (
  action_id uuid,
  type text,
  user_id uuid,
  payload jsonb,
  attempt integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_msg record;
  v_action public.actions%rowtype;
  v_returned integer := 0;
  v_read integer;
begin
  -- Every message read is either handed out, archived or left hidden for
  -- p_visibility_seconds, so reading again never returns it: the loop ends
  -- when the batch is full or no message is visible.
  loop
    v_read := 0;
    for v_msg in
      select * from pgmq.read('actions', p_visibility_seconds, p_batch - v_returned)
    loop
      v_read := v_read + 1;

      select * into v_action
      from public.actions a
      where a.id = (v_msg.message ->> 'action_id')::uuid
      for update;

      -- Orphan message or action already finished: drop the message.
      if v_action.id is null or v_action.status in ('succeeded', 'failed') then
        perform pgmq.archive('actions', v_msg.msg_id);
        continue;
      end if;

      -- Another worker is still running it: do not run it twice. pgmq.read
      -- already hid its message for p_visibility_seconds; that worker
      -- completes or fails it.
      if v_action.status = 'processing'
         and coalesce(v_action.started_at, v_action.updated_at) > now() - interval '10 minutes' then
        continue;
      end if;

      -- The worker died on every previous attempt: give up.
      if v_action.attempts >= v_action.max_attempts then
        update public.actions
        set status = 'failed',
            error = coalesce(error, 'max_attempts_reached'),
            finished_at = now(),
            next_attempt_at = null
        where id = v_action.id;
        perform pgmq.archive('actions', v_msg.msg_id);
        continue;
      end if;

      update public.actions
      set status = 'processing',
          attempts = attempts + 1,
          started_at = now(),
          next_attempt_at = null,
          queue_msg_id = v_msg.msg_id
      where id = v_action.id;

      action_id := v_action.id;
      type := v_action.type;
      user_id := v_action.user_id;
      payload := v_action.payload;
      attempt := v_action.attempts + 1;
      max_attempts := v_action.max_attempts;
      v_returned := v_returned + 1;
      return next;
    end loop;

    exit when v_read = 0 or v_returned >= p_batch;
  end loop;
end;
$$;

revoke all on function public.claim_actions(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_actions(integer, integer) to service_role;
