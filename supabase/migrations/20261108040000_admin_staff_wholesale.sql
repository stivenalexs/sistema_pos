-- Admin panel, part A (plan step 17a, D-054): staff invitations and the
-- wholesale review.
--
-- - Staff (admin, cashier, courier, warehouse) join by INVITATION: the
--   administrator records email, name and role; the auth.users triggers
--   recognise an invited email, give it staff_role in app_metadata and no
--   customer profile, and accept the invitation when the email is confirmed
--   (the person opened the link). This replaces creating staff through the admin API,
--   which the signup trigger rejected (D-045). The invitation email itself
--   is sent by Supabase Auth from the server.
-- - Deactivating staff removes the role and bans the login in the same
--   transaction.
-- - Approving or rejecting a wholesale customer updates customers AND
--   app_metadata.wholesale_approved in the same transaction (never out of
--   sync), with an insert-only history.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- ---------------------------------------------------------------------------
-- Staff invitations
-- ---------------------------------------------------------------------------

create type public.staff_invitation_status as enum ('pending', 'accepted', 'revoked');

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text not null check (length(trim(full_name)) between 3 and 120),
  phone text check (phone is null or phone ~ '^[0-9+ ]{7,20}$'),
  staff_role public.staff_role not null,
  -- SHA-256 of the one-time code sent with the Auth invitation (D-054).
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  status public.staff_invitation_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '7 days',
  invited_by uuid references auth.users (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One pending invitation per email.
create unique index staff_invitations_pending_email on public.staff_invitations (email) where status = 'pending';

create trigger set_updated_at before update on public.staff_invitations
  for each row execute function private.set_updated_at();

-- Staff deactivations (insert only).
create table public.staff_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  change text not null check (change in ('deactivated')),
  previous_role text,
  reason text not null check (length(trim(reason)) between 3 and 300),
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index staff_changes_user_idx on public.staff_changes (user_id, created_at desc);

create trigger staff_changes_insert_only before update or delete on public.staff_changes
  for each row execute function private.forbid_change();

-- Wholesale reviews (insert only).
create table public.wholesale_reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  decision public.wholesale_status not null check (decision in ('approved', 'rejected')),
  reason text not null check (length(trim(reason)) between 3 and 300),
  reviewed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index wholesale_reviews_customer_idx on public.wholesale_reviews (customer_id, created_at desc);

create trigger wholesale_reviews_insert_only before update or delete on public.wholesale_reviews
  for each row execute function private.forbid_change();

-- Only the administrator reads; nobody writes directly (functions only).
revoke all on public.staff_invitations, public.staff_changes, public.wholesale_reviews from anon, authenticated;
grant select on public.staff_invitations, public.staff_changes, public.wholesale_reviews to authenticated;

alter table public.staff_invitations enable row level security;
alter table public.staff_changes enable row level security;
alter table public.wholesale_reviews enable row level security;

create policy "staff_invitations: admin reads" on public.staff_invitations for select to authenticated
  using ((select private.has_staff_role(array['admin'])));
create policy "staff_changes: admin reads" on public.staff_changes for select to authenticated
  using ((select private.has_staff_role(array['admin'])));
create policy "wholesale_reviews: admin reads" on public.wholesale_reviews for select to authenticated
  using ((select private.has_staff_role(array['admin'])));

-- ---------------------------------------------------------------------------
-- Signup: an invited email becomes staff
-- ---------------------------------------------------------------------------
--
-- Supabase Auth creates the user in auth.users at the moment the invitation
-- email is SENT (inviteUserByEmail), unconfirmed and without a password. The
-- invitation is ACCEPTED later, when the person opens the link and Auth sets
-- email_confirmed_at. So:
--   - INSERT: the user gets staff_role and is linked to the invitation, which
--     stays pending (it can still be revoked or resent);
--   - UPDATE email_confirmed_at null -> set: the invitation is accepted and,
--     for a courier, the courier row is created.

create function private.require_admin()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_staff_role(array['admin']) then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
end;
$$;

-- BEFORE INSERT on auth.users, runs before the customer validation (trigger
-- names fire in alphabetical order: "a_..." < "validate_..."). With a valid
-- invitation it sets staff_role, so the customer triggers skip the user.
-- Only for the user created by OUR invitation: the server sends a one-time
-- code (staff_invite_token in user_metadata) whose SHA-256 is stored in the
-- invitation. A public sign-up with an invited email cannot know it, so it is
-- validated as a customer: nobody can register first with their own password
-- and wait for the invitee to confirm that account. (Auth sets invited_at
-- only after the insert, so it cannot tell them apart here.)
create function private.apply_staff_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.staff_invitations;
  v_token text := new.raw_user_meta_data ->> 'staff_invite_token';
begin
  if v_token is null then
    return new;
  end if;
  -- The code is used once and never stays in the session token.
  new.raw_user_meta_data := new.raw_user_meta_data - 'staff_invite_token';
  select * into v_invitation from public.staff_invitations
  where email = lower(trim(new.email)) and status = 'pending' and expires_at > now()
    and token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex');
  if v_invitation.id is not null then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('staff_role', v_invitation.staff_role);
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('full_name', v_invitation.full_name);
  end if;
  return new;
end;
$$;

create trigger a_apply_staff_invitation
  before insert on auth.users
  for each row execute function private.apply_staff_invitation();

-- AFTER INSERT: links the new (unconfirmed) user to its pending invitation.
create function private.link_staff_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.raw_app_meta_data ->> 'staff_role') is null then
    return null;
  end if;
  update public.staff_invitations
  set user_id = new.id
  where email = lower(trim(new.email)) and status = 'pending' and expires_at > now();
  return null;
end;
$$;

create trigger a_link_staff_invitation
  after insert on auth.users
  for each row execute function private.link_staff_invitation();

-- AFTER UPDATE: the person opened the link (email confirmed): accepted.
create function private.accept_staff_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.staff_invitations;
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.staff_invitations
    set status = 'accepted', accepted_at = now()
    where user_id = new.id and status = 'pending'
    returning * into v_invitation;

    if v_invitation.id is not null and v_invitation.staff_role = 'courier' then
      insert into public.couriers (id, provider_id, full_name, phone)
      select new.id, p.id, v_invitation.full_name, v_invitation.phone
      from public.delivery_providers p
      where p.kind = 'own'
      order by p.created_at
      limit 1
      on conflict (id) do update set is_active = true;
    end if;
  end if;
  return null;
end;
$$;

create trigger accept_staff_invitation
  after update of email_confirmed_at on auth.users
  for each row execute function private.accept_staff_invitation();

-- Auth may write app_metadata again after creating the user (D-045): keep
-- staff_role while the user's invitation is pending or accepted, unless the
-- administrator deactivated the account.
create function private.keep_invited_staff_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role;
begin
  if (new.raw_app_meta_data ->> 'staff_role') is null
     and (new.raw_app_meta_data -> 'staff_deactivated') is distinct from 'true'::jsonb then
    select staff_role into v_role from public.staff_invitations
    where user_id = new.id and status in ('pending', 'accepted')
    order by created_at desc
    limit 1;
    if v_role is not null then
      new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('staff_role', v_role);
    end if;
  end if;
  return new;
end;
$$;

create trigger keep_invited_staff_role
  before update of raw_app_meta_data on auth.users
  for each row execute function private.keep_invited_staff_role();

-- Auth may write user_metadata again after creating the user: the one-time
-- code never stays in it.
create function private.strip_staff_invite_token()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.raw_user_meta_data ? 'staff_invite_token' then
    new.raw_user_meta_data := new.raw_user_meta_data - 'staff_invite_token';
  end if;
  return new;
end;
$$;

create trigger strip_staff_invite_token
  before update of raw_user_meta_data on auth.users
  for each row execute function private.strip_staff_invite_token();

-- Deletes the auth user an invitation created if the person never opened
-- the link (unconfirmed). Used to revoke and to resend.
create function private.discard_unconfirmed_invitee(p_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users u
  where lower(u.email) = p_email
    and u.email_confirmed_at is null
    and exists (select 1 from public.staff_invitations i where i.user_id = u.id);
$$;

-- ---------------------------------------------------------------------------
-- Admin functions: staff
-- ---------------------------------------------------------------------------

-- Records an invitation; the server sends the email right after (Supabase
-- Auth) with the returned one-time "token" (only its SHA-256 is stored).
-- Inviting an email again RESENDS it: the previous pending invitation is
-- revoked and its unconfirmed user discarded. Returns {"ok": true,
-- "invitation_id", "email", "token", "resent"} or {"ok": false, "error": invalid_email
-- | invalid_name | invalid_phone | invalid_role | email_has_account}.
create function public.invite_staff(p_email text, p_full_name text, p_phone text, p_staff_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_full_name, ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_resent boolean;
  v_id uuid;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  perform private.require_admin();
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  if length(v_name) not between 3 and 120 then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;
  if v_phone is not null and v_phone !~ '^[0-9+ ]{7,20}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_phone');
  end if;
  if p_staff_role is null or p_staff_role not in ('admin', 'cashier', 'courier', 'warehouse') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;

  -- Resend: drop the earlier, never-opened invitation and its user.
  perform private.discard_unconfirmed_invitee(v_email);
  -- A real account (a customer, active or former staff) never becomes staff
  -- this way.
  if exists (select 1 from auth.users where lower(email) = v_email) then
    return jsonb_build_object('ok', false, 'error', 'email_has_account');
  end if;

  update public.staff_invitations set status = 'revoked', revoked_at = now()
  where email = v_email and status = 'pending';
  v_resent := found;

  insert into public.staff_invitations (email, full_name, phone, staff_role, token_hash, invited_by)
  values (v_email, v_name, v_phone, p_staff_role::public.staff_role,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'invitation_id', v_id, 'email', v_email, 'token', v_token, 'resent', v_resent);
end;
$$;

-- Revokes a pending invitation and discards its user if the link was never
-- opened (the link stops working).
create function public.revoke_staff_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  perform private.require_admin();
  update public.staff_invitations set status = 'revoked', revoked_at = now()
  where id = p_invitation_id and status = 'pending'
  returning email into v_email;
  if v_email is null then
    return false;
  end if;
  perform private.discard_unconfirmed_invitee(v_email);
  return true;
end;
$$;

-- Removes the role and bans the login, in one transaction. A token already
-- issued keeps working until it expires (up to 1 hour, D-031). For a courier
-- it also reports the deliveries still on their way, which the administrator
-- must reassign (step 17d).
create function public.deactivate_staff(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_reason text := trim(coalesce(p_reason, ''));
  v_open integer;
begin
  perform private.require_admin();
  if p_user_id = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'cannot_deactivate_self');
  end if;
  if length(v_reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  select raw_app_meta_data ->> 'staff_role' into v_role from auth.users where id = p_user_id for update;
  if v_role is null then
    return jsonb_build_object('ok', false, 'error', 'not_staff');
  end if;

  update auth.users
  set raw_app_meta_data = (raw_app_meta_data - 'staff_role') || '{"staff_deactivated": true}'::jsonb,
      -- Auth cannot read 'infinity' (sign-in answered 500): a far date.
      banned_until = now() + interval '100 years'
  where id = p_user_id;
  update public.couriers set is_active = false where id = p_user_id;
  insert into public.staff_changes (user_id, change, previous_role, reason, changed_by)
  values (p_user_id, 'deactivated', v_role, v_reason, auth.uid());

  select count(*) into v_open from public.orders where courier_id = p_user_id and status = 'out_for_delivery';
  return jsonb_build_object('ok', true, 'previous_role', v_role, 'open_deliveries', v_open);
end;
$$;

-- Staff members (accounts that opened their invitation) and pending
-- invitations for the panel.
create function public.admin_list_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', u.id,
        'email', u.email,
        'full_name', coalesce(u.raw_user_meta_data ->> 'full_name', u.email),
        'staff_role', u.raw_app_meta_data ->> 'staff_role',
        'last_sign_in_at', u.last_sign_in_at
      ) order by u.raw_app_meta_data ->> 'staff_role', u.email)
      from auth.users u
      where u.raw_app_meta_data ? 'staff_role' and u.email_confirmed_at is not null
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'full_name', i.full_name, 'staff_role', i.staff_role,
        'expires_at', i.expires_at, 'expired', i.expires_at <= now()
      ) order by i.created_at desc)
      from public.staff_invitations i
      where i.status = 'pending'
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin functions: wholesale review
-- ---------------------------------------------------------------------------

create function public.admin_list_wholesale(p_status text default 'pending')
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
      'customer_id', c.id,
      'business_name', c.business_name,
      'full_name', c.full_name,
      'nit', c.document_number,
      'phone', c.phone,
      'email', u.email,
      'status', c.wholesale_status,
      'created_at', c.created_at,
      'last_review', (
        select jsonb_build_object('decision', r.decision, 'reason', r.reason, 'created_at', r.created_at)
        from public.wholesale_reviews r where r.customer_id = c.id order by r.created_at desc limit 1
      )
    ) order by c.created_at)
    from public.customers c
    join auth.users u on u.id = c.id
    where c.customer_type = 'wholesale'
      and c.wholesale_status::text = coalesce(p_status, 'pending')
  ), '[]'::jsonb);
end;
$$;

-- Approves or rejects. customers and app_metadata change together; the
-- customer's session picks it up when it is refreshed (up to 1 hour, D-031).
create function public.review_wholesale(p_customer_id uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  perform private.require_admin();
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'invalid_decision');
  end if;
  if length(v_reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  select * into v_customer from public.customers where id = p_customer_id for update;
  if v_customer.id is null or v_customer.customer_type <> 'wholesale' then
    return jsonb_build_object('ok', false, 'error', 'not_wholesale');
  end if;

  if v_customer.wholesale_status::text = p_decision then
    return jsonb_build_object('ok', false, 'error', 'no_change');
  end if;

  update public.customers set wholesale_status = p_decision::public.wholesale_status where id = p_customer_id;
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('wholesale_approved', p_decision = 'approved')
  where id = p_customer_id;
  insert into public.wholesale_reviews (customer_id, decision, reason, reviewed_by)
  values (p_customer_id, p_decision::public.wholesale_status, v_reason, auth.uid());
  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

-- Counters for the panel home.
create function public.admin_summary()
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
    'pending_invitations', (select count(*) from public.staff_invitations where status = 'pending' and expires_at > now())
  );
end;
$$;

revoke all on function
  private.require_admin(),
  private.apply_staff_invitation(),
  private.link_staff_invitation(),
  private.accept_staff_invitation(),
  private.keep_invited_staff_role(),
  private.strip_staff_invite_token(),
  private.discard_unconfirmed_invitee(text)
from public;
grant execute on function private.require_admin() to authenticated;

revoke all on function
  public.invite_staff(text, text, text, text),
  public.revoke_staff_invitation(uuid),
  public.deactivate_staff(uuid, text),
  public.admin_list_staff(),
  public.admin_list_wholesale(text),
  public.review_wholesale(uuid, text, text),
  public.admin_summary()
from public, anon, authenticated;

-- Each checks the admin role inside.
grant execute on function
  public.invite_staff(text, text, text, text),
  public.revoke_staff_invitation(uuid),
  public.deactivate_staff(uuid, text),
  public.admin_list_staff(),
  public.admin_list_wholesale(text),
  public.review_wholesale(uuid, text, text),
  public.admin_summary()
to authenticated;
