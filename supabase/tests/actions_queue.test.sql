-- Tests for the async actions queue (plan step 7, D-034).
-- Run with `npm run db:test`. Everything is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- customer_profile = manual: these fixtures create their customers rows by hand.
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('40000000-0000-4000-8000-000000000001', 'a@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}'),
  ('40000000-0000-4000-8000-000000000002', 'b@test.local', 'authenticated', 'authenticated', '{"customer_profile":"manual"}');

-- Start from an empty queue inside this transaction.
delete from pgmq.q_actions;

-- ---------------------------------------------------------------------------
-- Enqueue and idempotency
-- ---------------------------------------------------------------------------

create temporary table t_first as
  select * from public.enqueue_action(
    '50000000-0000-4000-8000-000000000001', 'noop',
    '40000000-0000-4000-8000-000000000001', '{"n":1}');

select is((select created from t_first), true, 'enqueue: a new key creates an action');

select is(
  (select status::text from public.actions where id = (select tracking_id from t_first)),
  'queued',
  'enqueue: the action starts queued'
);

-- Same key again: the second tab or a network retry.
select is(
  (select tracking_id from public.enqueue_action(
    '50000000-0000-4000-8000-000000000001', 'noop',
    '40000000-0000-4000-8000-000000000001', '{"n":1}')),
  (select tracking_id from t_first),
  'idempotency: the same key returns the same tracking_id'
);

select is(
  (select count(*)::int from public.actions
   where idempotency_key = '50000000-0000-4000-8000-000000000001'),
  1,
  'idempotency: only one action row exists'
);

select is(
  (select count(*)::int from pgmq.q_actions),
  1,
  'idempotency: only one queue message exists'
);

select throws_ok(
  $$select * from public.enqueue_action(
      '50000000-0000-4000-8000-000000000001', 'noop',
      '40000000-0000-4000-8000-000000000002', '{}')$$,
  'P0001',
  'idempotency_key_conflict',
  'idempotency: a key of another user is rejected'
);

select throws_ok(
  $$select * from public.enqueue_action(
      '50000000-0000-4000-8000-000000000001', 'other_type',
      '40000000-0000-4000-8000-000000000001', '{}')$$,
  'P0001',
  'idempotency_key_conflict',
  'idempotency: a key reused for another action type is rejected'
);

select throws_ok(
  $$select * from public.enqueue_action(
      '50000000-0000-4000-8000-000000000009', 'Bad Type',
      '40000000-0000-4000-8000-000000000001', '{}')$$,
  '23514',
  null,
  'enqueue: an invalid action type is rejected'
);

-- ---------------------------------------------------------------------------
-- Claim, fail with retry, give up
-- ---------------------------------------------------------------------------

update public.actions set max_attempts = 2
where id = (select tracking_id from t_first);

create temporary table t_claim1 as select * from public.claim_actions(10, 60);

select is((select count(*)::int from t_claim1), 1, 'claim: returns the queued action');
select is((select attempt from t_claim1), 1, 'claim: first attempt is 1');
select is(
  (select status::text from public.actions where id = (select tracking_id from t_first)),
  'processing',
  'claim: the action is processing'
);
select is(
  (select count(*)::int from public.claim_actions(10, 60)),
  0,
  'claim: a claimed message is invisible to other workers'
);

select is(
  public.fail_action((select tracking_id from t_first), 'network error'),
  'queued'::public.action_status,
  'fail: with attempts left, the action goes back to the queue'
);
select ok(
  (select next_attempt_at > now() from public.actions where id = (select tracking_id from t_first)),
  'fail: the next attempt is scheduled in the future (backoff)'
);
select is(
  (select count(*)::int from public.claim_actions(10, 60)),
  0,
  'fail: the message is not visible before the backoff ends'
);

-- Simulate the end of the backoff.
select pgmq.set_vt('actions', (select queue_msg_id from public.actions where id = (select tracking_id from t_first)), 0);

create temporary table t_claim2 as select * from public.claim_actions(10, 60);
select is((select attempt from t_claim2), 2, 'retry: second attempt is 2');

select is(
  public.fail_action((select tracking_id from t_first), 'still failing'),
  'failed'::public.action_status,
  'fail: without attempts left, the action fails for good'
);
select is(
  (select count(*)::int from pgmq.q_actions),
  0,
  'fail: a failed action leaves no message in the queue'
);

-- ---------------------------------------------------------------------------
-- Success and permanent failure
-- ---------------------------------------------------------------------------

create temporary table t_ok as
  select * from public.enqueue_action(
    '50000000-0000-4000-8000-000000000002', 'noop',
    '40000000-0000-4000-8000-000000000001', '{}');
select * from public.claim_actions(10, 60);
select public.complete_action((select tracking_id from t_ok), '{"done":true}');

select is(
  (select status::text || ':' || (result ->> 'done') from public.actions
   where id = (select tracking_id from t_ok)),
  'succeeded:true',
  'complete: the action succeeds with its result'
);
select is((select count(*)::int from pgmq.q_actions), 0, 'complete: the message is removed');

create temporary table t_perm as
  select * from public.enqueue_action(
    '50000000-0000-4000-8000-000000000003', 'noop',
    '40000000-0000-4000-8000-000000000002', '{}');
select * from public.claim_actions(10, 60);
select is(
  public.fail_action((select tracking_id from t_perm), 'unknown_action_type', true),
  'failed'::public.action_status,
  'fail: a permanent error does not retry'
);

-- ---------------------------------------------------------------------------
-- Access from the API roles
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select results_eq(
  $$select idempotency_key::text from public.actions order by 1$$,
  array['50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002'],
  'rls: a user reads only its own actions'
);
select throws_ok(
  $$select * from public.enqueue_action(gen_random_uuid(), 'noop',
      '40000000-0000-4000-8000-000000000001', '{}')$$,
  '42501',
  null,
  'privileges: a signed-in user cannot enqueue directly'
);
select throws_ok(
  $$update public.actions set status = 'succeeded'$$,
  '42501',
  null,
  'privileges: a signed-in user cannot change actions'
);

reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_ok(
  $$select * from public.actions$$,
  '42501',
  null,
  'privileges: a visitor cannot read actions'
);

reset role;

select * from finish();
rollback;
