-- Payments with Wompi: attempts, raw events and idempotent processing
-- (plan step 12, D-040).
--
-- Source of truth: the Wompi webhook (D-013), never the browser redirect.
-- - payment_attempts: one row per checkout attempt. Unique reference per
--   attempt; at most ONE open attempt per order (partial unique index).
-- - payment_events: raw events, stored once (UNIQUE checksum) after the
--   signature was verified in the app (verify-signature.ts).
-- - apply_payment_event(): the worker applies an event atomically and
--   idempotently: checks amount, currency and reference, never moves a final
--   state backwards, marks the order paid and turns the reservation into a
--   sale. A payment that cannot be fulfilled is flagged for refund.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

create type public.payment_attempt_status as enum (
  'pending',    -- checkout started; no final answer yet
  'approved',
  'declined',
  'voided',
  'error',
  'abandoned'   -- replaced or never used before the order closed
);

alter table public.orders
  add column needs_refund boolean not null default false,
  add column refund_reason text,
  add constraint orders_refund_reason_check check (needs_refund = (refund_reason is not null));

create index orders_needs_refund_idx on public.orders (updated_at) where needs_refund;

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  -- Sent to Wompi; unique per attempt.
  reference text not null,
  -- Amount in cents only at the Wompi edge (agents.md §4): total_cop * 100.
  amount_in_cents bigint not null check (amount_in_cents > 0),
  currency text not null default 'COP' check (currency = 'COP'),
  status public.payment_attempt_status not null default 'pending',
  -- Wompi transaction id: from a verified event or the reconciliation. The
  -- redirect only stores it as an unverified hint (transaction_id_hint).
  wompi_transaction_id text,
  transaction_id_hint text check (transaction_id_hint ~ '^[0-9A-Za-z-]{6,64}$'),
  payment_method_type text,
  status_message text,
  expires_at timestamptz not null,
  idempotency_key uuid not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_attempts_reference_key unique (reference),
  constraint payment_attempts_idempotency_key_key unique (idempotency_key),
  constraint payment_attempts_order_number_key unique (order_id, attempt_number),
  constraint payment_attempts_transaction_key unique (wompi_transaction_id)
);

-- Never two open attempts for the same order.
create unique index payment_attempts_one_open
  on public.payment_attempts (order_id)
  where status = 'pending';

create trigger set_updated_at before update on public.payment_attempts
  for each row execute function private.set_updated_at();

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  -- Wompi checksum (or a reconciliation key): the same event is stored once.
  checksum text not null,
  source text not null check (source in ('webhook', 'reconciliation')),
  event_type text not null,
  transaction_id text,
  reference text,
  status text,
  amount_in_cents bigint,
  currency text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text,
  constraint payment_events_checksum_key unique (checksum)
);

create index payment_events_reference_idx on public.payment_events (reference);
create index payment_events_unprocessed_idx on public.payment_events (received_at) where processed_at is null;

-- Raw events are evidence: their payload never changes.
create function private.forbid_payload_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new.payload is distinct from old.payload
     or new.checksum is distinct from old.checksum then
    raise exception 'payment_events payload is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger payment_events_immutable
  before update or delete on public.payment_events
  for each row execute function private.forbid_payload_change();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on public.payment_attempts, public.payment_events from anon;
revoke insert, update, delete on public.payment_attempts, public.payment_events from authenticated;

alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;

create policy "payment_attempts: read with the order"
  on public.payment_attempts for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy "payment_events: admin reads"
  on public.payment_events for select to authenticated
  using ((select private.has_staff_role(array['admin'])));

-- ---------------------------------------------------------------------------
-- Start a payment (signed-in customer)
-- ---------------------------------------------------------------------------

-- Privileged part of start_payment, called after the caller's ownership of
-- the order was checked with RLS.
create function private.create_payment_attempt(
  p_order_id uuid,
  p_customer_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_action_id uuid;
  v_existing public.actions;
  v_open public.payment_attempts;
  v_attempt public.payment_attempts;
  v_number integer;
  v_ttl integer := private.setting_integer('reservation_ttl_minutes', 30);
  v_items jsonb;
begin
  -- Same key, same answer (double click, two tabs).
  insert into public.actions (idempotency_key, type, user_id, status, payload, attempts, started_at)
  values (p_idempotency_key, 'start_payment', p_customer_id, 'processing',
          jsonb_build_object('order_id', p_order_id), 1, now())
  on conflict (idempotency_key) do nothing
  returning id into v_action_id;

  if v_action_id is null then
    select * into v_existing from public.actions where idempotency_key = p_idempotency_key;
    if v_existing.user_id is distinct from p_customer_id or v_existing.type <> 'start_payment' then
      raise exception 'idempotency_key_conflict' using errcode = 'P0001';
    end if;
    select * into v_attempt from public.payment_attempts
    where id = (v_existing.result ->> 'attempt_id')::uuid;
    return jsonb_build_object('ok', true, 'tracking_id', v_existing.id, 'attempt', to_jsonb(v_attempt));
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.status <> 'awaiting_payment' then
    raise exception 'payment_order_not_payable' using errcode = '22023';
  end if;

  select * into v_open from public.payment_attempts
  where order_id = p_order_id and status = 'pending' for update;

  if v_open.id is not null then
    if v_open.wompi_transaction_id is not null or v_open.transaction_id_hint is not null then
      -- A real transaction is in progress (e.g. PSE): wait for its answer.
      raise exception 'payment_in_progress' using errcode = '22023';
    end if;
    -- The customer never paid with the previous attempt: replace it.
    update public.payment_attempts
    set status = 'abandoned', finalized_at = now()
    where id = v_open.id;
  end if;

  -- The stock reservation expired (30 min) but the order is still open:
  -- reserve again before paying. Fails if the stock is gone.
  if not exists (
    select 1 from public.stock_reservations
    where reference = p_order_id::text and status = 'active'
  ) then
    select jsonb_agg(jsonb_build_object('product_id', product_id, 'units', base_units))
    into v_items
    from public.order_items where order_id = p_order_id;
    perform private.reserve_units(p_order_id::text, v_items, v_ttl, p_customer_id);
    update public.orders
    set payment_deadline = now() + make_interval(mins => v_ttl)
    where id = p_order_id
    returning * into v_order;
  end if;

  select coalesce(max(attempt_number), 0) + 1 into v_number
  from public.payment_attempts where order_id = p_order_id;

  insert into public.payment_attempts (
    order_id, attempt_number, reference, amount_in_cents, expires_at, idempotency_key
  ) values (
    p_order_id,
    v_number,
    -- Short, unique and traceable to the order.
    upper(replace(p_order_id::text, '-', '')) || '-' || v_number,
    v_order.total_cop * 100,
    v_order.payment_deadline,
    p_idempotency_key
  )
  returning * into v_attempt;

  update public.actions
  set status = 'succeeded', result = jsonb_build_object('attempt_id', v_attempt.id), finished_at = now()
  where id = v_action_id;

  return jsonb_build_object('ok', true, 'tracking_id', v_action_id, 'attempt', to_jsonb(v_attempt));
end;
$$;

revoke all on function private.create_payment_attempt(uuid, uuid, uuid) from public;
grant execute on function private.create_payment_attempt(uuid, uuid, uuid) to authenticated;

-- Starts (or restarts) the payment of the caller's own order. Returns the
-- attempt; the app signs the checkout with the integrity secret.
create function public.start_payment(p_order_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_detail text;
begin
  if v_uid is null or not exists (
    select 1 from public.orders where id = p_order_id and customer_id = v_uid
  ) then
    raise exception 'payment_order_not_found' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'payment_missing_idempotency_key' using errcode = '22023';
  end if;

  begin
    return private.create_payment_attempt(p_order_id, v_uid, p_idempotency_key);
  exception when sqlstate '22023' then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm = 'inventory_insufficient_stock' then
      return jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'product_id', v_detail);
    end if;
    if sqlerrm in ('payment_in_progress', 'payment_order_not_payable') then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end if;
    raise;
  end;
end;
$$;

-- The redirect from Wompi brings ?id=<transaction>. It is NOT trusted: it is
-- only stored as a hint so that the reconciliation job can ask Wompi.
create function private.store_transaction_hint(p_order_id uuid, p_transaction_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_attempts
  set transaction_id_hint = p_transaction_id
  where order_id = p_order_id and status = 'pending'
    and transaction_id_hint is null and wompi_transaction_id is null;
$$;

revoke all on function private.store_transaction_hint(uuid, text) from public;
grant execute on function private.store_transaction_hint(uuid, text) to authenticated;

create function public.record_payment_redirect(p_order_id uuid, p_transaction_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_transaction_id is null or p_transaction_id !~ '^[0-9A-Za-z-]{6,64}$' then
    return;
  end if;
  -- RLS: only the customer's own order.
  if exists (select 1 from public.orders where id = p_order_id and customer_id = auth.uid()) then
    perform private.store_transaction_hint(p_order_id, p_transaction_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Events (server only)
-- ---------------------------------------------------------------------------

-- Stores a verified raw event once. Returns its id (existing or new) and
-- whether it was new.
create function public.store_payment_event(
  p_checksum text,
  p_source text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx jsonb := p_payload #> '{data,transaction}';
  v_id uuid;
begin
  insert into public.payment_events (
    checksum, source, event_type, transaction_id, reference, status, amount_in_cents, currency, payload
  ) values (
    upper(p_checksum),
    p_source,
    coalesce(p_payload ->> 'event', 'unknown'),
    v_tx ->> 'id',
    v_tx ->> 'reference',
    v_tx ->> 'status',
    (v_tx ->> 'amount_in_cents')::bigint,
    v_tx ->> 'currency',
    p_payload
  )
  on conflict (checksum) do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('event_id', v_id, 'created', true);
  end if;
  select id into v_id from public.payment_events where checksum = upper(p_checksum);
  return jsonb_build_object('event_id', v_id, 'created', false);
end;
$$;

-- Applies an event. Idempotent: a processed event is not applied again, and
-- an attempt in a final state never changes.
-- Outcomes: applied_approved, applied_declined, pending_ignored,
--           already_final, already_processed, unknown_reference,
--           amount_mismatch, not_a_transaction.
create function public.apply_payment_event(p_event_id uuid)
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
        exception when sqlstate '22023' then
          -- Paid, but the stock is gone (reservation expired and sold): the
          -- order is paid and must be refunded by the admin (plan step 17).
          update public.orders
          set status = 'paid', paid_at = now(),
              needs_refund = true, refund_reason = 'insufficient_stock_after_payment'
          where id = v_order.id;
        end;
      else
        -- Money arrived for an order that is no longer payable (e.g. cancelled
        -- after 24 hours): flag it for refund, do not reopen it.
        update public.orders
        set needs_refund = true, refund_reason = 'payment_for_closed_order'
        where id = v_order.id and not needs_refund;
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

-- Pending attempts to ask Wompi about (reconciliation job).
create function public.payments_to_reconcile(p_min_age_minutes integer default 15, p_limit integer default 50)
returns table (attempt_id uuid, transaction_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, coalesce(wompi_transaction_id, transaction_id_hint)
  from public.payment_attempts
  where status = 'pending'
    and coalesce(wompi_transaction_id, transaction_id_hint) is not null
    and created_at <= now() - make_interval(mins => p_min_age_minutes)
  order by created_at
  limit p_limit;
$$;

-- When an order is cancelled, its open attempt is closed too.
create function private.close_attempts_of_cancelled_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    -- Attempts with a real transaction stay pending: if Wompi approves them
    -- later, apply_payment_event flags the order for refund.
    update public.payment_attempts
    set status = 'abandoned', finalized_at = now()
    where order_id = new.id and status = 'pending'
      and wompi_transaction_id is null and transaction_id_hint is null;
  end if;
  return null;
end;
$$;

create trigger close_attempts_of_cancelled_order
  after update of status on public.orders
  for each row execute function private.close_attempts_of_cancelled_order();

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  private.forbid_payload_change(),
  private.close_attempts_of_cancelled_order()
from public;

revoke all on function
  public.start_payment(uuid, uuid),
  public.record_payment_redirect(uuid, text),
  public.store_payment_event(text, text, jsonb),
  public.apply_payment_event(uuid),
  public.payments_to_reconcile(integer, integer)
from public, anon, authenticated;

grant execute on function
  public.start_payment(uuid, uuid),
  public.record_payment_redirect(uuid, text)
to authenticated;

grant execute on function
  public.store_payment_event(text, text, jsonb),
  public.apply_payment_event(uuid),
  public.payments_to_reconcile(integer, integer)
to service_role;

-- ---------------------------------------------------------------------------
-- Reconciliation job: every 10 minutes, calls the app endpoint that asks
-- Wompi about pending attempts. URL and secret live in Vault:
--   payments_reconcile_url  e.g. https://<host>/api/workers/reconcile-payments
--   actions_worker_secret   same WORKER_SECRET as the actions worker
-- ---------------------------------------------------------------------------

create function private.invoke_payments_reconciliation()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'payments_reconcile_url';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'actions_worker_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  if not exists (
    select 1 from public.payment_attempts
    where status = 'pending' and coalesce(wompi_transaction_id, transaction_id_hint) is not null
  ) then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function private.invoke_payments_reconciliation() from public;

select cron.schedule(
  'reconcile-payments',
  '*/10 * * * *',
  'select private.invoke_payments_reconciliation()'
);
