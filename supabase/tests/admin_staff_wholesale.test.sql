-- Tests for the admin panel, part A (plan step 17a, D-054). Rolled back.
-- The inserts and updates on auth.users play the role of Supabase Auth:
-- inviteUserByEmail creates the user when the email is SENT (invited_at set,
-- unconfirmed); opening the link sets email_confirmed_at.

begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('d7000000-0000-4000-8000-000000000001', 'cliente17@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('d7000000-0000-4000-8000-000000000002', 'mayorista17@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual","customer_type":"wholesale","wholesale_approved":false}'),
  ('d7000000-0000-4000-8000-000000000021', 'admin17@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}');
insert into public.customers (id, customer_type, wholesale_status, full_name, business_name, document_type, document_number) values
  ('d7000000-0000-4000-8000-000000000001', 'retail', null, 'Cliente 17', null, null, null),
  ('d7000000-0000-4000-8000-000000000002', 'wholesale', 'pending', 'Mayorista 17', 'Licores 17 SAS', 'nit', '9001717171');

create function pg_temp.as_user(p_id text, p_meta text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":' || p_meta || '}', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.as_user('d7000000-0000-4000-8000-000000000021', '{"staff_role":"admin"}');
$$;
create function pg_temp.as_customer() returns void language sql as $$
  select pg_temp.as_user('d7000000-0000-4000-8000-000000000001', '{"customer_type":"retail"}');
$$;
-- One-time codes returned by invite_staff, as the server keeps them.
create temporary table t_tokens (email text primary key, token text);
grant all on t_tokens to authenticated;
create function pg_temp.invite(p_email text, p_name text, p_role text) returns jsonb language plpgsql as $$
declare r jsonb := public.invite_staff(p_email, p_name, null, p_role);
begin
  if (r ->> 'ok')::boolean then
    insert into t_tokens values (r ->> 'email', r ->> 'token') on conflict (email) do update set token = excluded.token;
  end if;
  return r;
end $$;
-- What inviteUserByEmail does when the email is sent: insert with the code
-- in user_metadata, then invited_at.
create function pg_temp.auth_invites(p_id uuid, p_email text) returns void language sql as $$
  insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data)
  values (p_id, p_email, 'authenticated', 'authenticated', '{"provider":"email","providers":["email"]}',
          jsonb_build_object('staff_invite_token', (select token from t_tokens where email = p_email)));
  update auth.users set invited_at = now() where id = p_id;
$$;
-- What opening the invitation link does.
create function pg_temp.auth_confirms(p_id uuid) returns void language sql as $$
  update auth.users set email_confirmed_at = now() where id = p_id;
$$;
create function pg_temp.invitation(p_email text) returns text language sql as $$
  select status::text || ':' || (user_id is not null) from public.staff_invitations
  where email = p_email order by created_at desc limit 1;
$$;
create function pg_temp.members(p_list jsonb) returns integer language sql as $$
  select count(*)::int from jsonb_array_elements(p_list -> 'members') m
  where m ->> 'email' in ('cajera17@test.local', 'moto17@test.local');
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------------------------------------------------------------------------
-- Permissions and validation
-- ---------------------------------------------------------------------------

select pg_temp.as_customer();
set local role authenticated;
select throws_ok($$select public.invite_staff('x@test.local', 'Persona X', null, 'cashier')$$,
  '42501', 'admin_forbidden', 'invite: a customer cannot invite');
select throws_ok($$select public.admin_list_staff()$$, '42501', 'admin_forbidden', 'staff list: a customer cannot read it');
select is_empty($$select * from public.staff_invitations$$, 'invite: a customer cannot read invitations');
reset role;

select pg_temp.as_admin();
set local role authenticated;
select is(pg_temp.invite(' Cajera17@Test.local ', 'Cajera Diecisiete', 'cashier') ->> 'email',
  'cajera17@test.local', 'invite: the admin invites, email normalized');
select is(pg_temp.invite('cliente17@test.local', 'Cliente', 'admin') ->> 'error',
  'email_has_account', 'invite: an existing account (a customer) never becomes staff');
select is(pg_temp.invite('nuevo@test.local', 'Persona Nueva', 'owner') ->> 'error', 'invalid_role', 'invite: unknown role');
select is(pg_temp.invite('no-es-correo', 'Persona Nueva', 'cashier') ->> 'error', 'invalid_email', 'invite: invalid email');
select is(pg_temp.invite('moto17@test.local', 'Mensajero Diecisiete', 'courier') ->> 'ok', 'true', 'invite: a courier');
reset role;

-- ---------------------------------------------------------------------------
-- Sent: the user exists, the invitation is still pending
-- ---------------------------------------------------------------------------

select pg_temp.auth_invites('d7000000-0000-4000-8000-000000000031', 'cajera17@test.local');
select pg_temp.auth_invites('d7000000-0000-4000-8000-000000000032', 'moto17@test.local');

select is((select raw_app_meta_data ->> 'staff_role' from auth.users where id = 'd7000000-0000-4000-8000-000000000031'),
  'cashier', 'sent: the invited user gets its staff role');
select ok(not exists (select 1 from public.customers where id = 'd7000000-0000-4000-8000-000000000031'),
  'sent: no customer profile for staff');
select is(pg_temp.invitation('cajera17@test.local'), 'pending:true', 'sent: the invitation stays pending, linked to the user');
select ok(not exists (select 1 from public.couriers where id = 'd7000000-0000-4000-8000-000000000032'),
  'sent: no courier row before the invitation is accepted');

select pg_temp.as_admin();
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.admin_list_staff() -> 'invitations')), 2,
  'sent: both invitations are listed as pending');
select is(pg_temp.members(public.admin_list_staff()), 0, 'sent: they are not members yet');
select is((public.admin_summary() ->> 'staff')::int, 0, 'summary: invitees are not counted as staff');
reset role;

-- ---------------------------------------------------------------------------
-- Accepted: the person opened the link
-- ---------------------------------------------------------------------------

select pg_temp.auth_confirms('d7000000-0000-4000-8000-000000000031');
select pg_temp.auth_confirms('d7000000-0000-4000-8000-000000000032');

select is(pg_temp.invitation('cajera17@test.local'), 'accepted:true', 'accepted: when the email is confirmed');
select is((select is_active from public.couriers where id = 'd7000000-0000-4000-8000-000000000032'), true,
  'accepted: the courier row is created then');
select pg_temp.as_admin();
set local role authenticated;
select is(pg_temp.members(public.admin_list_staff()), 2, 'accepted: both are members now');
select is(pg_temp.invite('cajera17@test.local', 'Cajera', 'cashier') ->> 'error',
  'email_has_account', 'accepted: a confirmed account cannot be invited again');
reset role;

-- Auth rewriting app_metadata keeps the role (D-045).
update auth.users set raw_app_meta_data = '{"provider":"email","providers":["email"]}' where id = 'd7000000-0000-4000-8000-000000000031';
select is((select raw_app_meta_data ->> 'staff_role' from auth.users where id = 'd7000000-0000-4000-8000-000000000031'),
  'cashier', 'role: a later app_metadata rewrite keeps it');

-- ---------------------------------------------------------------------------
-- Revoke, resend, expiry and public sign-up
-- ---------------------------------------------------------------------------

select pg_temp.as_admin();
set local role authenticated;
select is(pg_temp.invite('revocada17@test.local', 'Invitación Revocada', 'cashier') ->> 'ok', 'true', 'revoke: invite');
reset role;
select pg_temp.auth_invites('d7000000-0000-4000-8000-000000000033', 'revocada17@test.local');
select pg_temp.as_admin();
set local role authenticated;
select ok(public.revoke_staff_invitation((select id from public.staff_invitations where email = 'revocada17@test.local')),
  'revoke: a sent invitation can be revoked');
reset role;
select is(pg_temp.invitation('revocada17@test.local'), 'revoked:false', 'revoke: revoked');
select ok(not exists (select 1 from auth.users where id = 'd7000000-0000-4000-8000-000000000033'),
  'revoke: the unconfirmed user is discarded (the link stops working)');

select pg_temp.as_admin();
set local role authenticated;
select is(pg_temp.invite('reenvio17@test.local', 'Invitación Reenviada', 'warehouse') ->> 'resent', 'false', 'resend: first invitation');
reset role;
select pg_temp.auth_invites('d7000000-0000-4000-8000-000000000034', 'reenvio17@test.local');
select pg_temp.as_admin();
set local role authenticated;
select is(pg_temp.invite('reenvio17@test.local', 'Invitación Reenviada', 'warehouse') ->> 'resent', 'true',
  'resend: inviting the same email again resends it');
reset role;
select is((select count(*)::int from public.staff_invitations where email = 'reenvio17@test.local' and status = 'pending'), 1,
  'resend: a single pending invitation');
select ok(not exists (select 1 from auth.users where id = 'd7000000-0000-4000-8000-000000000034'),
  'resend: the previous unconfirmed user is discarded so Auth can create it again');

select pg_temp.as_admin();
set local role authenticated;
select is(pg_temp.invite('vencida17@test.local', 'Invitación Vencida', 'cashier') ->> 'ok', 'true', 'expiry: invite');
select is(pg_temp.invite('publica17@test.local', 'Invitación Pública', 'admin') ->> 'ok', 'true', 'signup: invite');
reset role;
update public.staff_invitations set expires_at = now() - interval '1 minute' where email = 'vencida17@test.local';
select throws_ok(
  $$select pg_temp.auth_invites(gen_random_uuid(), 'vencida17@test.local')$$,
  '22023', 'signup_invalid_customer_type', 'expiry: an expired invitation does not make staff'
);
select ok(not exists (select 1 from auth.users where raw_user_meta_data ? 'staff_invite_token'),
  'code: the one-time code never stays in user_metadata');
select ok((select token_hash <> (select token from t_tokens where email = 'cajera17@test.local')
           from public.staff_invitations where email = 'cajera17@test.local' and status = 'accepted'),
  'code: only its hash is stored');
-- A public sign-up (without the code) with an invited email is a customer sign-up.
select throws_ok(
  $$insert into auth.users (id, email, aud, role, raw_app_meta_data) values
    (gen_random_uuid(), 'publica17@test.local', 'authenticated', 'authenticated', '{"provider":"email"}')$$,
  '22023', 'signup_invalid_customer_type', 'signup: a public sign-up with an invited email never becomes staff'
);
select throws_ok(
  $$insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
    (gen_random_uuid(), 'publica17@test.local', 'authenticated', 'authenticated', '{"provider":"email"}', '{"staff_invite_token":"adivinado"}')$$,
  '22023', 'signup_invalid_customer_type', 'signup: a wrong code never becomes staff'
);

-- ---------------------------------------------------------------------------
-- Deactivation
-- ---------------------------------------------------------------------------

select pg_temp.as_admin();
set local role authenticated;
select is(public.deactivate_staff('d7000000-0000-4000-8000-000000000021', 'Prueba') ->> 'error',
  'cannot_deactivate_self', 'deactivate: not yourself');
select is(
  (select (r ->> 'previous_role') || ':' || (r ->> 'open_deliveries')
   from (select public.deactivate_staff('d7000000-0000-4000-8000-000000000032', 'Ya no trabaja aquí') r) x),
  'courier:0', 'deactivate: a courier, with the deliveries still on their way'
);
reset role;

select is(
  (select coalesce(raw_app_meta_data ->> 'staff_role', 'none') || ':' || (banned_until > now() + interval '50 years')
   from auth.users where id = 'd7000000-0000-4000-8000-000000000032'),
  'none:true', 'deactivate: no role and the login is banned'
);
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"provider":"email"}' where id = 'd7000000-0000-4000-8000-000000000032';
select is((select raw_app_meta_data ->> 'staff_role' from auth.users where id = 'd7000000-0000-4000-8000-000000000032'),
  null, 'deactivate: the role does not come back');
select is((select is_active from public.couriers where id = 'd7000000-0000-4000-8000-000000000032'), false,
  'deactivate: the courier row is inactive');
select throws_ok($$update public.staff_changes set reason = 'otra'$$, '42501', null, 'deactivate: the history cannot be changed');

-- ---------------------------------------------------------------------------
-- Wholesale review
-- ---------------------------------------------------------------------------

select pg_temp.as_customer();
set local role authenticated;
select throws_ok($$select public.review_wholesale('d7000000-0000-4000-8000-000000000002', 'approved', 'NIT verificado')$$,
  '42501', 'admin_forbidden', 'review: a customer cannot approve');
reset role;

select pg_temp.as_admin();
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.admin_list_wholesale()) w where w ->> 'nit' = '9001717171'), 1,
  'review: the pending wholesale customer is listed');
select is(public.review_wholesale('d7000000-0000-4000-8000-000000000002', 'approved', 'x') ->> 'error', 'invalid_reason',
  'review: a reason is required');
select is(public.review_wholesale('d7000000-0000-4000-8000-000000000001', 'approved', 'NIT verificado') ->> 'error', 'not_wholesale',
  'review: only wholesale customers');
select is(public.review_wholesale('d7000000-0000-4000-8000-000000000002', 'approved', 'NIT verificado en el RUES') ->> 'ok', 'true',
  'review: approve');
select is(public.review_wholesale('d7000000-0000-4000-8000-000000000002', 'approved', 'Doble clic') ->> 'error', 'no_change',
  'review: the same decision twice is not recorded again');
reset role;

select is(
  (select c.wholesale_status::text || ':' || (u.raw_app_meta_data ->> 'wholesale_approved')
   from public.customers c join auth.users u on u.id = c.id where c.id = 'd7000000-0000-4000-8000-000000000002'),
  'approved:true', 'review: customers and app_metadata change together'
);

select pg_temp.as_admin();
set local role authenticated;
select is(public.review_wholesale('d7000000-0000-4000-8000-000000000002', 'rejected', 'NIT no coincide con la razón social') ->> 'status',
  'rejected', 'review: a later rejection');
reset role;
select is(
  (select c.wholesale_status::text || ':' || (u.raw_app_meta_data ->> 'wholesale_approved')
   from public.customers c join auth.users u on u.id = c.id where c.id = 'd7000000-0000-4000-8000-000000000002'),
  'rejected:false', 'review: rejected, back to retail prices'
);
select is((select count(*)::int from public.wholesale_reviews where customer_id = 'd7000000-0000-4000-8000-000000000002'), 2,
  'review: both decisions are in the history');
select throws_ok($$update public.wholesale_reviews set reason = 'otra'$$, '42501', null, 'review: the history cannot be changed');

select * from finish();
rollback;
