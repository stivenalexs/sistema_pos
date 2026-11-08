-- Admin panel, part D-1: POS voids and delivery assignment (plan step 17d-1, D-057).
--
-- 1. config_changes: insert-only history of configuration changes, written
--    by a trigger. Attached here to delivery_providers; step 17d-2 attaches
--    it to zones, fee rules and store settings.
-- 2. Panel reads (admin only, role checked first): admin_list_pos_sales,
--    admin_list_deliveries, admin_list_delivery_options.
-- 3. admin_summary adds deliveries to assign and deliveries whose current
--    assignment failed; it and admin_list_invoices leave out invoices of
--    voided POS sales and orders to refund (they are never invoiced).
-- 4. delivery_providers: one own-couriers provider, always active; the
--    administrator creates and changes only third parties; names unique
--    ignoring case.
--
-- void_pos_sale (D-053) and assign_delivery (D-045) are used as they are.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Configuration history
-- ---------------------------------------------------------------------------

create table public.config_changes (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  -- No foreign key: the history outlives the row it describes.
  row_id text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb,
  changed_by uuid,
  created_at timestamptz not null default now()
);

create index config_changes_row_idx on public.config_changes (table_name, row_id, created_at desc);

create trigger config_changes_insert_only
  before update or delete on public.config_changes
  for each row execute function private.forbid_change();

revoke all on public.config_changes from anon, authenticated;
grant select on public.config_changes to authenticated;
alter table public.config_changes enable row level security;

create policy "config_changes: admin reads"
  on public.config_changes for select
  to authenticated
  using ((select private.has_staff_role(array['admin'])));

-- Writes one history row per changed row. Who changed it comes from the
-- session (it cannot be forged). The row key is its id, or its key for
-- app_settings. An UPDATE that changes nothing is not recorded.
create function private.log_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;
  insert into public.config_changes (table_name, row_id, operation, old_row, new_row, changed_by)
  values (
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'key', v_old ->> 'key'),
    tg_op, v_old, v_new, auth.uid()
  );
  return null;
end;
$$;

create trigger log_config_change
  after insert or update or delete on public.delivery_providers
  for each row execute function private.log_config_change();

-- ---------------------------------------------------------------------------
-- Delivery providers: the own couriers' provider is fixed
-- ---------------------------------------------------------------------------

-- Exactly one provider of own couriers, always active; the administrator
-- manages only third parties (D-057). Names are unique ignoring case and
-- surrounding spaces ("Coordinadora" and " coordinadora" are the same).
create unique index delivery_providers_one_own on public.delivery_providers (kind) where kind = 'own';
create unique index delivery_providers_name_ci on public.delivery_providers (lower(trim(name)));
alter table public.delivery_providers
  add constraint delivery_providers_own_active check (kind <> 'own' or is_active);

drop policy "delivery_providers: admin inserts" on public.delivery_providers;
drop policy "delivery_providers: admin updates" on public.delivery_providers;

create policy "delivery_providers: admin inserts third parties"
  on public.delivery_providers for insert to authenticated
  with check ((select private.has_staff_role(array['admin'])) and kind = 'third_party');
create policy "delivery_providers: admin updates third parties"
  on public.delivery_providers for update to authenticated
  using ((select private.has_staff_role(array['admin'])) and kind = 'third_party')
  with check ((select private.has_staff_role(array['admin'])) and kind = 'third_party');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Name shown for a staff member: their invitation name, or their email when
-- they were created without one (by SQL).
create function private.staff_display_name(p_user_id uuid)
returns text
language sql
stable
-- Null in, null out without reading anything (most sales have no voided_by).
strict
security definer
set search_path = ''
as $$
  select coalesce(
    (select i.full_name from public.staff_invitations i
     where i.user_id = p_user_id order by i.created_at desc limit 1),
    (select u.email::text from auth.users u where u.id = p_user_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Panel reads (admin only)
-- ---------------------------------------------------------------------------

-- Latest POS sales, newest first, with invoice and void state.
create function public.admin_list_pos_sales(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(row_data order by created_at desc, order_id)
    from (
      select o.created_at, o.id as order_id, jsonb_build_object(
        'order_id', o.id,
        'created_at', o.created_at,
        'status', o.status,
        'total_cop', o.total_cop,
        'payment_method', o.pos_payment_method,
        'cashier', private.staff_display_name(o.cashier_id),
        -- Company name for wholesale buyers, as on their invoice.
        'customer', coalesce(c.business_name, c.full_name),
        -- Bottles (base units), whether sold by unit or by box.
        'units', o.total_base_units,
        'invoice_status', inv.status,
        'invoice_number', inv.factus_number,
        'voided_at', o.voided_at,
        'void_reason', o.void_reason,
        'voided_by', private.staff_display_name(o.voided_by)
      ) as row_data
      from public.orders o
      left join public.customers c on c.id = o.customer_id
      left join public.invoices inv on inv.order_id = o.id
      where o.channel = 'pos'
      order by o.created_at desc, o.id
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) s
  ), '[]'::jsonb);
end;
$$;

-- Web delivery orders the administrator handles: paid and waiting for a
-- courier, or on the way. Orders marked for refund are left out (they are
-- not delivered). Includes the last failed attempt, if any.
create function public.admin_list_deliveries()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    -- Unassigned first, then oldest payment first.
    select jsonb_agg(row_data order by is_assigned, paid_ts, order_id)
    from (
      select
        o.status = 'out_for_delivery' as is_assigned,
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

-- Providers (all, to activate or deactivate them) and the active own
-- couriers that assign_delivery accepts.
create function public.admin_list_delivery_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'is_active', p.is_active)
                       order by p.kind, p.name)
      from public.delivery_providers p
    ), '[]'::jsonb),
    'couriers', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.full_name, 'phone', c.phone, 'provider_id', c.provider_id)
                       order by c.full_name)
      from public.couriers c
      join public.delivery_providers p on p.id = c.provider_id and p.is_active and p.kind = 'own'
      where c.is_active and private.user_staff_role(c.id) = 'courier'
    ), '[]'::jsonb)
  );
end;
$$;

-- Panel home: also deliveries to assign and deliveries with a failed attempt.
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
    ),
    'deliveries_failed', (
      select count(*) from public.orders o
      where o.channel = 'web' and o.fulfillment = 'delivery' and not o.needs_refund and o.status = 'out_for_delivery'
        -- The last attempt of the current assignment failed.
        and (select a.outcome from public.delivery_attempts a
             where a.order_id = o.id and (o.assigned_at is null or a.created_at >= o.assigned_at)
             order by a.created_at desc limit 1) = 'failed'
    )
  );
end;
$$;

-- Invoices page: same criterion as the summary, so a voided POS sale or an
-- order to refund never leaves an invoice alert that cannot be cleared
-- (retry_invoice rejects them).
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

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function private.log_config_change(), private.staff_display_name(uuid) from public;

revoke all on function
  public.admin_list_pos_sales(integer),
  public.admin_list_deliveries(),
  public.admin_list_delivery_options()
from public, anon, authenticated;

-- Each checks the admin role inside.
grant execute on function
  public.admin_list_pos_sales(integer),
  public.admin_list_deliveries(),
  public.admin_list_delivery_options()
to authenticated;
