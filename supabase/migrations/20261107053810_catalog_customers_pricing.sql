-- Catalog, customers and price lists with RLS (plan step 6, D-031).
--
-- Who sees what is decided by RLS from the JWT app_metadata (never
-- user_metadata). Those claims are written only by the server with the
-- secret key:
--   app_metadata.staff_role          admin | cashier | courier | warehouse
--   app_metadata.customer_type       retail | wholesale
--   app_metadata.wholesale_approved  true | false
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.customer_type as enum ('retail', 'wholesale');
create type public.wholesale_status as enum ('pending', 'approved', 'rejected');
create type public.staff_role as enum ('admin', 'cashier', 'courier', 'warehouse');
create type public.product_origin as enum ('national', 'imported');
create type public.document_type as enum ('cc', 'ce', 'nit', 'passport');

-- ---------------------------------------------------------------------------
-- Private helpers (schema not exposed by the API)
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- app_metadata from the current JWT, or an empty object.
create function private.app_metadata()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata', '{}'::jsonb);
$$;

-- True when the current user has one of the given internal roles.
create function private.has_staff_role(roles text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((private.app_metadata() ->> 'staff_role') = any (roles), false);
$$;

-- True only for wholesale customers already approved by an administrator.
-- A pending wholesale customer is treated as retail (D-031).
create function private.is_approved_wholesale()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    private.app_metadata() ->> 'customer_type' = 'wholesale'
      and private.app_metadata() -> 'wholesale_approved' = 'true'::jsonb,
    false
  );
$$;

-- Imported products are visible only to approved wholesale customers and to
-- staff who handle the whole catalog (D-003, D-031).
create function private.can_see_imported()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.is_approved_wholesale()
    or private.has_staff_role(array['admin', 'cashier', 'warehouse']);
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on all functions in schema private from public;
grant execute on function
  private.app_metadata(),
  private.has_staff_role(text[]),
  private.is_approved_wholesale(),
  private.can_see_imported()
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  customer_type public.customer_type not null,
  -- Prices in a retail list are per unit; in a wholesale list, per box.
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_lists_name_key unique (name)
);

-- At most one default list per customer type.
create unique index price_lists_one_default_per_type
  on public.price_lists (customer_type)
  where is_default;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null check (length(trim(sku)) > 0),
  name text not null check (length(trim(name)) > 0),
  description text,
  brand text,
  volume_ml integer check (volume_ml > 0),
  origin public.product_origin not null,
  units_per_box integer not null check (units_per_box > 0),
  -- Retail customers buy by unit only, and only when this is on (D-024).
  allow_retail_by_unit boolean not null default false,
  retail_min_units integer not null default 1 check (retail_min_units >= 1),
  wholesale_min_boxes integer not null default 1 check (wholesale_min_boxes >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_sku_key unique (sku)
);

create index products_active_origin_idx
  on public.products (origin)
  where is_active;

create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.price_lists (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  -- Final price to the customer in whole Colombian pesos.
  -- PENDIENTE DE CONFIRMAR (P-005): assumed to include taxes.
  price_cop bigint not null check (price_cop > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_prices_list_product_key unique (price_list_id, product_id)
);

create index product_prices_product_idx on public.product_prices (product_id);

create table public.customers (
  -- Same id as the auth user. The row is created at sign-up (plan step 8).
  id uuid primary key references auth.users (id) on delete cascade,
  customer_type public.customer_type not null,
  wholesale_status public.wholesale_status,
  full_name text not null check (length(trim(full_name)) > 0),
  document_type public.document_type,
  document_number text check (length(trim(document_number)) > 0),
  phone text,
  -- Optional special list. When null, the default list of the type applies.
  price_list_id uuid references public.price_lists (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_wholesale_status_check check (
    (customer_type = 'wholesale') = (wholesale_status is not null)
  ),
  constraint customers_document_check check (
    (document_type is null) = (document_number is null)
  ),
  constraint customers_document_key unique (document_type, document_number)
);

create index customers_price_list_idx on public.customers (price_list_id);

-- Special price list assigned to the current user, or null.
-- SECURITY DEFINER so that policies can call it for visitors, who have no
-- privileges on customers. It only ever returns the caller's own value.
create function private.assigned_price_list_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.price_list_id
  from public.customers c
  where c.id = auth.uid();
$$;

revoke all on function private.assigned_price_list_id() from public;
grant execute on function private.assigned_price_list_id()
  to anon, authenticated, service_role;
create index customers_pending_wholesale_idx
  on public.customers (created_at)
  where wholesale_status = 'pending';

create trigger set_updated_at before update on public.price_lists
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.products
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.product_prices
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Customer data is never readable without a session.
revoke all on public.customers from anon;
-- Signed-in customers may change only their name and phone. Type, approval
-- and price list are changed by the server with the secret key.
revoke insert, update, delete on public.customers from authenticated;
grant update (full_name, phone) on public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.price_lists enable row level security;
alter table public.products enable row level security;
alter table public.product_prices enable row level security;
alter table public.customers enable row level security;

-- customers ----------------------------------------------------------------

create policy "customers: read own row"
  on public.customers for select
  to authenticated
  using (id = (select auth.uid()));

create policy "customers: admin reads all"
  on public.customers for select
  to authenticated
  using ((select private.has_staff_role(array['admin'])));

create policy "customers: update own row"
  on public.customers for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- products ------------------------------------------------------------------

-- Visitors, retail, pending wholesale and couriers: active national products.
-- Approved wholesale and cashiers: every active product.
-- Admin and warehouse: everything, including inactive products.
create policy "products: read by visibility"
  on public.products for select
  to anon, authenticated
  using (
    (select private.has_staff_role(array['admin', 'warehouse']))
    or (
      is_active
      and (origin = 'national' or (select private.can_see_imported()))
    )
  );

create policy "products: admin inserts"
  on public.products for insert
  to authenticated
  with check ((select private.has_staff_role(array['admin'])));

create policy "products: admin updates"
  on public.products for update
  to authenticated
  using ((select private.has_staff_role(array['admin'])))
  with check ((select private.has_staff_role(array['admin'])));

create policy "products: admin deletes"
  on public.products for delete
  to authenticated
  using ((select private.has_staff_role(array['admin'])));

-- price_lists ---------------------------------------------------------------

-- Everyone: the default retail list.
-- Approved wholesale: the default wholesale list.
-- Signed-in customers: the list assigned to them, if it is retail or they are
--   approved wholesale (a pending wholesale customer never sees wholesale prices).
-- Admin, cashier and warehouse: every list.
create policy "price_lists: read by visibility"
  on public.price_lists for select
  to anon, authenticated
  using (
    (select private.has_staff_role(array['admin', 'cashier', 'warehouse']))
    or (customer_type = 'retail' and is_default)
    or (
      customer_type = 'wholesale'
      and is_default
      and (select private.is_approved_wholesale())
    )
    or (
      id = (select private.assigned_price_list_id())
      and (customer_type = 'retail' or (select private.is_approved_wholesale()))
    )
  );

create policy "price_lists: admin inserts"
  on public.price_lists for insert
  to authenticated
  with check ((select private.has_staff_role(array['admin'])));

create policy "price_lists: admin updates"
  on public.price_lists for update
  to authenticated
  using ((select private.has_staff_role(array['admin'])))
  with check ((select private.has_staff_role(array['admin'])));

create policy "price_lists: admin deletes"
  on public.price_lists for delete
  to authenticated
  using ((select private.has_staff_role(array['admin'])));

-- product_prices ------------------------------------------------------------

-- A price is readable only when both its list and its product are readable.
-- The subqueries run under the RLS of those tables, so an imported product's
-- price or a wholesale price never reaches a retail customer.
create policy "product_prices: read when list and product are visible"
  on public.product_prices for select
  to anon, authenticated
  using (
    exists (select 1 from public.price_lists pl where pl.id = price_list_id)
    and exists (select 1 from public.products p where p.id = product_id)
  );

create policy "product_prices: admin inserts"
  on public.product_prices for insert
  to authenticated
  with check ((select private.has_staff_role(array['admin'])));

create policy "product_prices: admin updates"
  on public.product_prices for update
  to authenticated
  using ((select private.has_staff_role(array['admin'])))
  with check ((select private.has_staff_role(array['admin'])));

create policy "product_prices: admin deletes"
  on public.product_prices for delete
  to authenticated
  using ((select private.has_staff_role(array['admin'])));
