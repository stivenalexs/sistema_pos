-- Taxes and electronic invoicing with Factus (plan step 13, D-042, D-044).
--
-- - Tax model (D-042, project assumptions under D-041): catalog prices are
--   FINAL prices. For the invoice the tax breakdown is computed backwards:
--   participation (specific + ad valorem), Antioquia exploitation right and
--   IVA 5 % over base + departmental taxes.
-- - Factus has no tax code for the liquor consumption tax, so each invoice
--   line goes with price = base + participation + exploitation, and only
--   IVA (code 01) as tax (D-044).
-- - One invoice per paid order (UNIQUE order_id and reference_code), issued
--   by a worker. Orders flagged for refund are not invoiced (D-044).
-- - Credit notes reference the original invoice; invoices are never deleted.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Tax data
-- ---------------------------------------------------------------------------

create type public.tax_category as enum ('spirits', 'wine', 'non_wine_aperitif');

alter table public.products
  add column alcohol_degree numeric(4,1) check (alcohol_degree >= 0 and alcohol_degree <= 100),
  add column tax_category public.tax_category,
  -- Product of the Fábrica de Licores de Antioquia: no exploitation right.
  add column is_fla boolean not null default false;

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 2100),
  tax_category public.tax_category not null,
  -- Specific component, pesos per alcohol degree for a 750 cc unit.
  specific_per_degree_cop integer not null check (specific_per_degree_cop >= 0),
  ad_valorem_pct numeric(5,2) not null check (ad_valorem_pct >= 0),
  -- Antioquia exploitation right for products that are not from the FLA.
  exploitation_pct numeric(5,2) not null default 0 check (exploitation_pct >= 0),
  created_at timestamptz not null default now(),
  constraint tax_rates_year_category_key unique (year, tax_category)
);

-- 2026 rates (D-042). Exploitation right: PROJECT ASSUMPTION, not for wine.
insert into public.tax_rates (year, tax_category, specific_per_degree_cop, ad_valorem_pct, exploitation_pct) values
  (2026, 'spirits', 360, 25, 2),
  (2026, 'non_wine_aperitif', 360, 25, 2),
  (2026, 'wine', 243, 20, 0);

insert into public.app_settings (key, value) values ('iva_rate_pct', '5'::jsonb);

revoke all on public.tax_rates from anon;
revoke insert, update, delete on public.tax_rates from authenticated;
alter table public.tax_rates enable row level security;
create policy "tax_rates: staff reads" on public.tax_rates for select to authenticated
  using ((select private.has_staff_role(array['admin', 'cashier', 'warehouse'])));

-- Tax breakdown of a line whose FINAL total is p_final_cop (D-042):
--   final = base + specific + ad_valorem + exploitation + iva
--   iva   = iva% x (base + specific + ad_valorem + exploitation)
-- Solved backwards; the rounding difference is absorbed by the base so the
-- line adds up exactly to what was charged. A product without tax data is
-- treated as IVA only (PROJECT ASSUMPTION).
create function private.tax_breakdown(p_product_id uuid, p_units integer, p_final_cop bigint)
returns table (
  base_cop bigint,
  specific_cop bigint,
  ad_valorem_cop bigint,
  exploitation_cop bigint,
  iva_cop bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_rate public.tax_rates;
  v_iva numeric := private.setting_integer('iva_rate_pct', 5)::numeric / 100;
  v_specific bigint := 0;
  v_adv numeric := 0;
  v_expl numeric := 0;
  v_base bigint;
  v_ad_valorem bigint;
  v_exploitation bigint;
  v_iva_cop bigint;
begin
  select * into v_product from public.products where id = p_product_id;
  select * into v_rate from public.tax_rates
  where tax_category = v_product.tax_category
    and year = extract(year from (now() at time zone 'America/Bogota'))::integer;

  if v_rate.id is not null and v_product.alcohol_degree is not null and v_product.volume_ml is not null then
    v_specific := round(v_rate.specific_per_degree_cop * v_product.alcohol_degree
                        * v_product.volume_ml / 750.0) * p_units;
    v_adv := v_rate.ad_valorem_pct / 100;
    v_expl := case when v_product.is_fla then 0 else v_rate.exploitation_pct / 100 end;
  end if;

  v_base := round((p_final_cop / (1 + v_iva) - v_specific) / (1 + v_adv + v_expl));
  v_ad_valorem := round(v_adv * v_base);
  v_exploitation := round(v_expl * v_base);
  v_iva_cop := round(v_iva * (v_base + v_specific + v_ad_valorem + v_exploitation));
  -- Absorb the rounding difference in the base.
  v_base := p_final_cop - v_specific - v_ad_valorem - v_exploitation - v_iva_cop;

  return query select v_base, v_specific, v_ad_valorem, v_exploitation, v_iva_cop;
end;
$$;

revoke all on function private.tax_breakdown(uuid, integer, bigint) from public;

-- ---------------------------------------------------------------------------
-- Invoices and credit notes
-- ---------------------------------------------------------------------------

create type public.invoice_status as enum ('pending', 'sent', 'accepted', 'rejected');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  -- Sent to Factus; unique per invoice (D-014).
  reference_code text not null,
  status public.invoice_status not null default 'pending',
  -- Buyer data copied when the invoice is prepared (it never changes later).
  customer jsonb not null,
  payment_method_code text not null,
  total_cop bigint not null check (total_cop > 0),
  iva_cop bigint not null,
  participation_cop bigint not null,
  exploitation_cop bigint not null,
  base_cop bigint not null,
  factus_number text,
  cufe text,
  qr_url text,
  public_url text,
  dian_errors jsonb,
  last_error text,
  attempts integer not null default 0,
  request jsonb,
  response jsonb,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_order_key unique (order_id),
  constraint invoices_reference_key unique (reference_code),
  constraint invoices_cufe_key unique (cufe),
  constraint invoices_total_check check (total_cop = base_cop + participation_cop + exploitation_cop + iva_cop)
);

create index invoices_open_idx on public.invoices (status, updated_at) where status in ('pending', 'sent', 'rejected');

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  sku text not null,
  name text not null,
  -- Always in units (code 94, D-044): a box of 12 is 12 units.
  quantity_units integer not null check (quantity_units > 0),
  final_cop bigint not null,
  base_cop bigint not null,
  specific_cop bigint not null,
  ad_valorem_cop bigint not null,
  exploitation_cop bigint not null,
  iva_cop bigint not null,
  -- What Factus receives as line net (before IVA): base + departmental taxes.
  net_cop bigint generated always as (base_cop + specific_cop + ad_valorem_cop + exploitation_cop) stored,
  constraint invoice_lines_total_check check (
    final_cop = base_cop + specific_cop + ad_valorem_cop + exploitation_cop + iva_cop
  )
);

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  reference_code text not null,
  reason text not null check (length(trim(reason)) > 0),
  status public.invoice_status not null default 'pending',
  factus_number text,
  cufe text,
  last_error text,
  attempts integer not null default 0,
  request jsonb,
  response jsonb,
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_notes_reference_key unique (reference_code),
  -- A full credit note per invoice (refund of the whole order).
  constraint credit_notes_invoice_key unique (invoice_id)
);

create trigger set_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.credit_notes
  for each row execute function private.set_updated_at();
create trigger invoice_lines_insert_only before update or delete on public.invoice_lines
  for each row execute function private.forbid_change();

revoke all on public.invoices, public.invoice_lines, public.credit_notes from anon;
revoke insert, update, delete on public.invoices, public.invoice_lines, public.credit_notes from authenticated;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.credit_notes enable row level security;

create policy "invoices: read with the order" on public.invoices for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy "invoice_lines: read with the invoice" on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));
create policy "credit_notes: admin reads" on public.credit_notes for select to authenticated
  using ((select private.has_staff_role(array['admin'])));

-- ---------------------------------------------------------------------------
-- Enqueue the invoice when an order becomes paid
-- ---------------------------------------------------------------------------

-- Deterministic UUID from a text: the same order, the same action key.
create function private.uuid_from_text(p_text text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-a'
          || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select md5(p_text) as h) s;
$$;

create function private.enqueue_invoice_on_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and not new.needs_refund then
    perform public.enqueue_action(
      private.uuid_from_text('issue_invoice:' || new.id::text),
      'issue_invoice',
      null,
      jsonb_build_object('order_id', new.id),
      8
    );
  end if;
  return null;
end;
$$;

create trigger enqueue_invoice_on_paid
  after update of status on public.orders
  for each row execute function private.enqueue_invoice_on_paid();

-- ---------------------------------------------------------------------------
-- Worker functions (server only)
-- ---------------------------------------------------------------------------

-- Prepares (once) the invoice of a paid order with its tax breakdown and the
-- buyer's data, and returns it for the Factus request. Idempotent.
create function public.prepare_invoice(p_order_id uuid)
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
begin
  select * into v_invoice from public.invoices where order_id = p_order_id;

  if v_invoice.id is null then
    select * into v_order from public.orders where id = p_order_id for update;
    if v_order.id is null or v_order.status <> 'paid' or v_order.needs_refund then
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

    select coalesce(a.payment_method_type, 'UNKNOWN') into v_method
    from public.payment_attempts a
    where a.order_id = p_order_id and a.status = 'approved'
    order by a.finalized_at desc limit 1;

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

    select sum(base_cop) b, sum(specific_cop + ad_valorem_cop) p, sum(exploitation_cop) e, sum(iva_cop) i
    into v_totals from public.invoice_lines where invoice_id = v_invoice.id;

    update public.invoices
    set base_cop = v_totals.b, participation_cop = v_totals.p,
        exploitation_cop = v_totals.e, iva_cop = v_totals.i
    where id = v_invoice.id
    returning * into v_invoice;
  end if;

  return to_jsonb(v_invoice) || jsonb_build_object(
    'lines', (select jsonb_agg(to_jsonb(l) order by l.sku) from public.invoice_lines l where l.invoice_id = v_invoice.id)
  );
end;
$$;

-- Records what Factus answered. p_outcome: sent | accepted | rejected | error.
create function public.record_invoice_result(
  p_invoice_id uuid,
  p_outcome text,
  p_request jsonb,
  p_response jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb := p_response -> 'data';
begin
  update public.invoices
  set attempts = attempts + 1,
      request = coalesce(p_request, request),
      response = coalesce(p_response, response),
      last_error = p_error,
      sent_at = coalesce(sent_at, now()),
      status = case p_outcome
        when 'accepted' then 'accepted'::public.invoice_status
        when 'rejected' then 'rejected'::public.invoice_status
        when 'sent' then 'sent'::public.invoice_status
        else status end,
      factus_number = coalesce(v_data ->> 'number', factus_number),
      cufe = coalesce(v_data ->> 'cufe', cufe),
      qr_url = coalesce(v_data #>> '{links,qr}', qr_url),
      public_url = coalesce(v_data #>> '{links,public_url}', public_url),
      dian_errors = coalesce(v_data -> 'errors', dian_errors),
      accepted_at = case when p_outcome = 'accepted' then now() else accepted_at end,
      rejected_at = case when p_outcome = 'rejected' then now() else rejected_at end
  where id = p_invoice_id
    -- An accepted invoice never changes.
    and status <> 'accepted';
end;
$$;

-- Admin asks for a credit note (full refund of the order's invoice).
create function public.request_credit_note(p_invoice_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_id uuid;
begin
  if not (private.is_service_role() or private.has_staff_role(array['admin'])) then
    raise exception 'credit_note_forbidden' using errcode = '42501';
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice.status <> 'accepted' then
    raise exception 'credit_note_invoice_not_accepted' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'credit_note_missing_reason' using errcode = '22023';
  end if;

  insert into public.credit_notes (invoice_id, reference_code, reason, requested_by)
  values (p_invoice_id, 'NC-' || upper(replace(p_invoice_id::text, '-', '')), trim(p_reason), auth.uid())
  on conflict (invoice_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.credit_notes where invoice_id = p_invoice_id;
    return v_id;
  end if;

  perform public.enqueue_action(
    private.uuid_from_text('issue_credit_note:' || v_id::text),
    'issue_credit_note', null, jsonb_build_object('credit_note_id', v_id), 8
  );
  return v_id;
end;
$$;

create function public.record_credit_note_result(
  p_credit_note_id uuid,
  p_outcome text,
  p_request jsonb,
  p_response jsonb,
  p_error text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.credit_notes
  set attempts = attempts + 1,
      request = coalesce(p_request, request),
      response = coalesce(p_response, response),
      last_error = p_error,
      status = case p_outcome
        when 'accepted' then 'accepted'::public.invoice_status
        when 'rejected' then 'rejected'::public.invoice_status
        when 'sent' then 'sent'::public.invoice_status
        else status end,
      factus_number = coalesce(p_response #>> '{data,number}', factus_number),
      cufe = coalesce(p_response #>> '{data,cufe}', cufe)
  where id = p_credit_note_id and status <> 'accepted';
$$;

revoke all on function
  private.uuid_from_text(text),
  private.enqueue_invoice_on_paid()
from public;

revoke all on function
  public.prepare_invoice(uuid),
  public.record_invoice_result(uuid, text, jsonb, jsonb, text),
  public.request_credit_note(uuid, text),
  public.record_credit_note_result(uuid, text, jsonb, jsonb, text)
from public, anon, authenticated;

grant execute on function
  public.prepare_invoice(uuid),
  public.record_invoice_result(uuid, text, jsonb, jsonb, text),
  public.record_credit_note_result(uuid, text, jsonb, jsonb, text)
to service_role;

grant execute on function public.request_credit_note(uuid, text) to authenticated, service_role;
