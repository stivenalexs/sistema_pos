-- Customer sign-up with age verification and legal audit (plan step 8, D-035).
--
-- When Supabase Auth creates a user from the sign-up form, these triggers:
--   1. reject the sign-up if the person is under 18 (date in America/Bogota),
--      if a required field is missing or if the legal texts were not accepted;
--   2. write customer_type and wholesale_approved = false to app_metadata;
--   3. create the customers row and the legal_acceptances audit rows;
--   4. remove the birth date and NIT from user_metadata (data minimisation),
--      also on every later update, because Auth rewrites user_metadata.
-- Everything happens in the same transaction as the auth.users insert, so a
-- rejected sign-up leaves nothing behind.
--
-- Users created by the server (staff, tests) skip this when their
-- app_metadata has staff_role or customer_profile = 'manual'. app_metadata
-- can only be set with the secret key.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Schema changes
-- ---------------------------------------------------------------------------

alter table public.customers
  add column business_name text check (length(trim(business_name)) > 0);

create type public.legal_document as enum ('age_gate', 'terms', 'privacy');

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  -- Set null if the user is deleted: the evidence of acceptance is kept.
  user_id uuid references auth.users (id) on delete set null,
  document public.legal_document not null,
  -- Version of src/modules/compliance/legal-copy.ts that was accepted.
  version text not null check (length(trim(version)) > 0),
  -- Only for the age_gate document: the birth date the person declared.
  declared_birth_date date,
  accepted_at timestamptz not null default now(),
  constraint legal_acceptances_birth_date_check check (
    (document = 'age_gate') = (declared_birth_date is not null)
  )
);

create index legal_acceptances_user_idx
  on public.legal_acceptances (user_id, accepted_at desc);

-- Insert-only: no one edits or deletes acceptance evidence.
create function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is insert-only', tg_table_name
    using errcode = '42501';
end;
$$;

create trigger legal_acceptances_insert_only
  before update or delete on public.legal_acceptances
  for each row execute function private.forbid_change();

revoke all on public.legal_acceptances from anon;
revoke insert, update, delete on public.legal_acceptances from authenticated;

alter table public.legal_acceptances enable row level security;

create policy "legal_acceptances: read own"
  on public.legal_acceptances for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "legal_acceptances: admin reads all"
  on public.legal_acceptances for select
  to authenticated
  using ((select private.has_staff_role(array['admin'])));

-- ---------------------------------------------------------------------------
-- Sign-up triggers
-- ---------------------------------------------------------------------------

-- True for users created by the server that must not get a customer profile.
create function private.is_server_provisioned(p_app_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_app_metadata, '{}'::jsonb) ? 'staff_role'
    or coalesce(p_app_metadata ->> 'customer_profile', '') = 'manual';
$$;

create function private.signup_error(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- The message starts with "signup_" so that the app can map it to a
  -- message in Spanish.
  raise exception 'signup_%', p_code using errcode = '22023';
end;
$$;

-- BEFORE INSERT: validate and set app_metadata.
create function private.validate_customer_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_type text := m ->> 'customer_type';
  v_birth date;
  v_today date := (now() at time zone 'America/Bogota')::date;
begin
  if private.is_server_provisioned(new.raw_app_meta_data) then
    return new;
  end if;

  if v_type is null or v_type not in ('retail', 'wholesale') then
    perform private.signup_error('invalid_customer_type');
  end if;
  if length(trim(coalesce(m ->> 'full_name', ''))) = 0 then
    perform private.signup_error('missing_full_name');
  end if;

  begin
    v_birth := (m ->> 'birth_date')::date;
  exception when others then
    v_birth := null;
  end;
  if v_birth is null or v_birth > v_today or v_birth < date '1900-01-01' then
    perform private.signup_error('invalid_birth_date');
  end if;
  -- Of age on the 18th birthday, counted in Colombian time.
  if v_birth > (v_today - interval '18 years')::date then
    perform private.signup_error('underage');
  end if;

  if m -> 'accept_age' is distinct from 'true'::jsonb
     or m -> 'accept_terms' is distinct from 'true'::jsonb
     or m -> 'accept_privacy' is distinct from 'true'::jsonb then
    perform private.signup_error('legal_not_accepted');
  end if;
  if length(trim(coalesce(m ->> 'legal_version', ''))) = 0 then
    perform private.signup_error('missing_legal_version');
  end if;

  if v_type = 'wholesale' then
    if length(trim(coalesce(m ->> 'business_name', ''))) = 0 then
      perform private.signup_error('missing_business_name');
    end if;
    if coalesce(m ->> 'nit', '') !~ '^[0-9]{6,12}(-?[0-9])?$' then
      perform private.signup_error('invalid_nit');
    end if;
  end if;

  -- Merge, never replace: Auth keeps provider data in app_metadata.
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('customer_type', v_type, 'wholesale_approved', false);
  return new;
end;
$$;

-- AFTER INSERT: create the customer and the audit rows, then minimise data.
create function private.create_customer_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_type public.customer_type;
  v_version text := trim(m ->> 'legal_version');
  v_nit text;
begin
  if private.is_server_provisioned(new.raw_app_meta_data) then
    return null;
  end if;

  v_type := (m ->> 'customer_type')::public.customer_type;
  v_nit := nullif(replace(m ->> 'nit', '-', ''), '');

  insert into public.customers (
    id, customer_type, wholesale_status, full_name, business_name,
    document_type, document_number, phone
  ) values (
    new.id,
    v_type,
    case when v_type = 'wholesale' then 'pending'::public.wholesale_status end,
    trim(m ->> 'full_name'),
    case when v_type = 'wholesale' then trim(m ->> 'business_name') end,
    case when v_type = 'wholesale' then 'nit'::public.document_type end,
    case when v_type = 'wholesale' then v_nit end,
    nullif(trim(m ->> 'phone'), '')
  );

  insert into public.legal_acceptances (user_id, document, version, declared_birth_date)
  values
    (new.id, 'age_gate', v_version, (m ->> 'birth_date')::date),
    (new.id, 'terms', v_version, null),
    (new.id, 'privacy', v_version, null);

  -- The birth date and NIT now live only in the audit and customers tables;
  -- user_metadata is copied into every session token.
  update auth.users
  set raw_user_meta_data = raw_user_meta_data
    - 'birth_date' - 'nit' - 'accept_age' - 'accept_terms' - 'accept_privacy'
  where id = new.id;

  return null;
end;
$$;

-- BEFORE UPDATE: Supabase Auth rewrites user_metadata right after creating
-- the user, which would bring the birth date and NIT back. Strip them on
-- every update so that they never stay in the session token.
create function private.strip_sensitive_user_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.raw_user_meta_data ?| array['birth_date', 'nit', 'accept_age', 'accept_terms', 'accept_privacy'] then
    new.raw_user_meta_data := new.raw_user_meta_data
      - 'birth_date' - 'nit' - 'accept_age' - 'accept_terms' - 'accept_privacy';
  end if;
  return new;
end;
$$;

revoke all on function private.strip_sensitive_user_metadata() from public;
revoke all on function private.validate_customer_signup() from public;
revoke all on function private.create_customer_profile() from public;
revoke all on function private.is_server_provisioned(jsonb) from public;
revoke all on function private.signup_error(text) from public;
revoke all on function private.forbid_change() from public;

create trigger validate_customer_signup
  before insert on auth.users
  for each row execute function private.validate_customer_signup();

create trigger create_customer_profile
  after insert on auth.users
  for each row execute function private.create_customer_profile();

create trigger strip_sensitive_user_metadata
  before update of raw_user_meta_data on auth.users
  for each row execute function private.strip_sensitive_user_metadata();
