-- Tests for customer sign-up, age verification and legal audit (plan step 8, D-035).
-- Run with `npm run db:test`. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Sign-up metadata as the app sends it, with the birth date relative to
-- today in Colombia.
create function pg_temp.meta(
  p_type text,
  p_birth date,
  p_extra jsonb default '{}'::jsonb
) returns jsonb language sql as $$
  select jsonb_build_object(
    'full_name', 'Persona de prueba',
    'customer_type', p_type,
    'birth_date', p_birth::text,
    'accept_age', true,
    'accept_terms', true,
    'accept_privacy', true,
    'legal_version', '0-borrador'
  ) || p_extra;
$$;

create function pg_temp.today_co() returns date language sql as $$
  select (now() at time zone 'America/Bogota')::date;
$$;

create function pg_temp.signup(p_id uuid, p_meta jsonb, p_app jsonb default '{}'::jsonb)
returns void language sql as $$
  insert into auth.users (id, email, aud, role, raw_user_meta_data, raw_app_meta_data)
  values (p_id, p_id::text || '@test.local', 'authenticated', 'authenticated', p_meta, p_app);
$$;

-- ---------------------------------------------------------------------------
-- Valid retail sign-up
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select pg_temp.signup('70000000-0000-4000-8000-000000000001',
      pg_temp.meta('retail', (pg_temp.today_co() - interval '30 years')::date))$$,
  'retail: an adult can sign up'
);
select is(
  (select customer_type::text || ':' || full_name from public.customers
   where id = '70000000-0000-4000-8000-000000000001'),
  'retail:Persona de prueba',
  'retail: the customers row is created'
);
select is(
  (select jsonb_build_array(raw_app_meta_data -> 'customer_type', raw_app_meta_data -> 'wholesale_approved')
   from auth.users where id = '70000000-0000-4000-8000-000000000001'),
  '["retail", false]'::jsonb,
  'retail: app_metadata gets customer_type and wholesale_approved = false'
);
select ok(
  (select not (raw_user_meta_data ? 'birth_date') and not (raw_user_meta_data ? 'accept_terms')
   from auth.users where id = '70000000-0000-4000-8000-000000000001'),
  'retail: the birth date is removed from user_metadata'
);
select results_eq(
  $$select document::text || ':' || version from public.legal_acceptances
    where user_id = '70000000-0000-4000-8000-000000000001' order by document$$,
  array['age_gate:0-borrador', 'terms:0-borrador', 'privacy:0-borrador'],
  'audit: age gate, terms and privacy are recorded with the text version'
);
select is(
  (select declared_birth_date from public.legal_acceptances
   where user_id = '70000000-0000-4000-8000-000000000001' and document = 'age_gate'),
  (pg_temp.today_co() - interval '30 years')::date,
  'audit: the declared birth date is kept with the age acceptance'
);

-- ---------------------------------------------------------------------------
-- Age limit
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select pg_temp.signup('70000000-0000-4000-8000-000000000002',
      pg_temp.meta('retail', (pg_temp.today_co() - interval '18 years')::date))$$,
  'age: turning 18 today (Colombian date) is accepted'
);
select throws_ok(
  $$select pg_temp.signup('70000000-0000-4000-8000-000000000003',
      pg_temp.meta('retail', (pg_temp.today_co() - interval '18 years' + interval '1 day')::date))$$,
  '22023',
  'signup_underage',
  'age: one day before turning 18 is rejected'
);
select throws_ok(
  $$select pg_temp.signup('70000000-0000-4000-8000-000000000004',
      pg_temp.meta('retail', (pg_temp.today_co() + 1)))$$,
  '22023',
  'signup_invalid_birth_date',
  'age: a future birth date is rejected'
);

-- ---------------------------------------------------------------------------
-- Legal acceptance and customer type
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select pg_temp.signup('70000000-0000-4000-8000-000000000005',
      pg_temp.meta('retail', '1990-01-01', '{"accept_terms": false}'))$$,
  '22023',
  'signup_legal_not_accepted',
  'legal: not accepting the terms is rejected'
);
select throws_ok(
  $$select pg_temp.signup('70000000-0000-4000-8000-000000000006',
      pg_temp.meta('retail', '1990-01-01', '{"accept_privacy": "yes"}'))$$,
  '22023',
  'signup_legal_not_accepted',
  'legal: only a real true counts as acceptance'
);
select throws_ok(
  $$select pg_temp.signup('70000000-0000-4000-8000-000000000007',
      pg_temp.meta('admin', '1990-01-01'))$$,
  '22023',
  'signup_invalid_customer_type',
  'type: an invalid customer type is rejected'
);

-- ---------------------------------------------------------------------------
-- Wholesale
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select pg_temp.signup('70000000-0000-4000-8000-000000000008',
      pg_temp.meta('wholesale', '1985-05-05',
        '{"business_name": "Licores Ejemplo SAS", "nit": "900123456-7"}'))$$,
  'wholesale: a business can sign up'
);
select is(
  (select wholesale_status::text || ':' || business_name || ':' || document_type::text || ':' || document_number
   from public.customers where id = '70000000-0000-4000-8000-000000000008'),
  'pending:Licores Ejemplo SAS:nit:9001234567',
  'wholesale: starts pending, with business name and NIT'
);
select throws_ok(
  $$select pg_temp.signup('70000000-0000-4000-8000-000000000009',
      pg_temp.meta('wholesale', '1985-05-05', '{"nit": "900123456-7"}'))$$,
  '22023',
  'signup_missing_business_name',
  'wholesale: the business name is required'
);
select throws_ok(
  $$select pg_temp.signup('70000000-0000-4000-8000-000000000010',
      pg_temp.meta('wholesale', '1985-05-05', '{"business_name": "X", "nit": "abc"}'))$$,
  '22023',
  'signup_invalid_nit',
  'wholesale: an invalid NIT is rejected'
);

-- user_metadata is written by the user: it must not grant anything.
select pg_temp.signup('70000000-0000-4000-8000-000000000011',
  pg_temp.meta('wholesale', '1985-05-05',
    '{"business_name": "Y SAS", "nit": "800111222", "wholesale_approved": true, "staff_role": "admin"}'));
select is(
  (select jsonb_build_object(
      'approved', raw_app_meta_data -> 'wholesale_approved',
      'has_staff_role', raw_app_meta_data ? 'staff_role')
   from auth.users where id = '70000000-0000-4000-8000-000000000011'),
  '{"approved": false, "has_staff_role": false}'::jsonb,
  'security: approval or staff role in user_metadata is ignored'
);

-- ---------------------------------------------------------------------------
-- Server-provisioned users and audit integrity
-- ---------------------------------------------------------------------------

select pg_temp.signup('70000000-0000-4000-8000-000000000012', '{}'::jsonb, '{"staff_role": "cashier"}');
select is(
  (select count(*)::int from public.customers where id = '70000000-0000-4000-8000-000000000012'),
  0,
  'staff: a user created by the server with staff_role gets no customer profile'
);

select throws_ok(
  $$update public.legal_acceptances set version = 'x'
    where user_id = '70000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'audit: acceptances cannot be edited, not even by postgres'
);
select throws_ok(
  $$delete from public.legal_acceptances
    where user_id = '70000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'audit: acceptances cannot be deleted'
);

select set_config('request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(distinct user_id)::int from public.legal_acceptances),
  1,
  'rls: a user reads only its own acceptances'
);
select throws_ok(
  $$insert into public.legal_acceptances (user_id, document, version)
    values ('70000000-0000-4000-8000-000000000002', 'terms', 'fake')$$,
  '42501',
  null,
  'rls: a user cannot write acceptances'
);

reset role;

select * from finish();
rollback;
