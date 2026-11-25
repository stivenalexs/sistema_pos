-- The recipient's ID document leaves the queue when confirm_delivery ends,
-- and a POS void waits only while the invoice is really being issued
-- (thermos findings, D-071; D-074). Rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('e9000000-0000-4000-8000-000000000001', 'msj@test.local', 'authenticated', 'authenticated', '{"staff_role":"courier"}'),
  ('e9000000-0000-4000-8000-000000000011', 'caja@test.local', 'authenticated', 'authenticated', '{"staff_role":"cashier"}'),
  ('e9000000-0000-4000-8000-000000000021', 'adm@test.local', 'authenticated', 'authenticated', '{"staff_role":"admin"}');

create function pg_temp.as_user(p_id text, p_meta text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":' || p_meta || '}', true);
$$;
grant execute on all functions in schema pg_temp to authenticated;

delete from pgmq.q_actions;

-- ---------------------------------------------------------------------------
-- 1. confirm_delivery payload
-- ---------------------------------------------------------------------------

create function pg_temp.confirm(p_key uuid) returns uuid language sql as $$
  select tracking_id from public.enqueue_action(p_key, 'confirm_delivery', 'e9000000-0000-4000-8000-000000000001',
    jsonb_build_object('order_id', gen_random_uuid(), 'attempt_key', p_key, 'outcome', 'delivered',
      'recipient_name', 'Ana Pérez', 'document_number', '1020304050', 'age_confirmed', true,
      'signature_path', 'x/y.png'));
$$;
create function pg_temp.payload(p_id uuid) returns jsonb language sql as $$
  select payload from public.actions where id = p_id;
$$;

create temporary table t_ok as select pg_temp.confirm(gen_random_uuid()) as id;
select is(pg_temp.payload((select id from t_ok)) ->> 'document_number', '1020304050',
  'queued: the worker still has the document it needs');

select * from public.claim_actions(1, 60);
select is(pg_temp.payload((select id from t_ok)) ->> 'document_number', '1020304050',
  'processing: the document is still there');
select public.complete_action((select id from t_ok), '{"outcome":"delivered"}');
select ok(
  not (pg_temp.payload((select id from t_ok)) ?| array['document_number', 'recipient_name']),
  'succeeded: the name and the ID document are gone'
);
select ok(
  pg_temp.payload((select id from t_ok)) ?& array['order_id', 'attempt_key', 'outcome', 'signature_path'],
  'succeeded: the rest of the payload stays'
);

create temporary table t_retry as select pg_temp.confirm(gen_random_uuid()) as id;
select * from public.claim_actions(1, 60);
select public.fail_action((select id from t_retry), 'network error');
select is(pg_temp.payload((select id from t_retry)) ->> 'document_number', '1020304050',
  'retry pending: the document stays for the next attempt');
select pgmq.set_vt('actions', (select queue_msg_id from public.actions where id = (select id from t_retry)), 0);
select * from public.claim_actions(1, 60);
select public.fail_action((select id from t_retry), 'invalid_payload', true);
select ok(
  not (pg_temp.payload((select id from t_retry)) ?| array['document_number', 'recipient_name']),
  'failed for good: the name and the ID document are gone'
);

create temporary table t_other as
  select tracking_id as id from public.enqueue_action(gen_random_uuid(), 'noop', 'e9000000-0000-4000-8000-000000000001',
    '{"document_number":"not a delivery"}');
select * from public.claim_actions(1, 60);
select public.complete_action((select id from t_other), null);
select is(pg_temp.payload((select id from t_other)) ->> 'document_number', 'not a delivery',
  'other action types are not touched');

-- An action created already ended never keeps the document.
insert into public.actions (idempotency_key, type, user_id, status, payload, finished_at)
values (gen_random_uuid(), 'confirm_delivery', 'e9000000-0000-4000-8000-000000000001', 'failed',
  '{"outcome":"delivered","recipient_name":"Ana","document_number":"1020304050"}', now())
returning id \gset ins_
select ok(
  not (pg_temp.payload(:'ins_id') ?| array['document_number', 'recipient_name']),
  'insert: an action inserted already ended is stripped too'
);

-- retry_action refuses a delivered confirmation without its document, and
-- still requeues a failed attempt (which never carried one).
create temporary table t_failed_attempt as
  select tracking_id as id from public.enqueue_action(gen_random_uuid(), 'confirm_delivery', 'e9000000-0000-4000-8000-000000000001',
    '{"order_id":"8d3c7a9e-2b1f-4c6d-9e8a-1f2b3c4d5e6f","outcome":"failed","failure_reason":"recipient_absent"}');
select * from public.claim_actions(1, 60);
select public.fail_action((select id from t_failed_attempt), 'boom', true);
grant select on t_retry, t_failed_attempt to authenticated;

select pg_temp.as_user('e9000000-0000-4000-8000-000000000021', '{"staff_role":"admin"}');
set local role authenticated;
select is(
  public.retry_action((select id from t_retry), 'Reintento desde el panel') ->> 'error',
  'delivery_proof_data_removed', 'retry: a delivered confirmation without its document is refused'
);
select is(
  public.retry_action((select id from t_failed_attempt), 'Reintento desde el panel') ->> 'ok',
  'true', 'retry: a failed attempt without document can still be requeued'
);
reset role;

-- ---------------------------------------------------------------------------
-- 2. void_pos_sale
-- ---------------------------------------------------------------------------

create function pg_temp.pos_sale() returns uuid language plpgsql as $$
begin
  perform pg_temp.as_user('e9000000-0000-4000-8000-000000000011', '{"staff_role":"cashier"}');
  return (public.create_pos_sale(gen_random_uuid(),
    '[{"product_id":"00000000-0000-4000-8000-000000000101","quantity":1}]', 'card', null, null, true) ->> 'order_id')::uuid;
end;
$$;
create function pg_temp.void(p_order uuid) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user('e9000000-0000-4000-8000-000000000021', '{"staff_role":"admin"}');
  return public.void_pos_sale(p_order, 'Error de digitación');
end;
$$;
create function pg_temp.end_invoice_job(p_order uuid, p_status text) returns void language sql as $$
  update public.actions set status = p_status::public.action_status, finished_at = now()
  where idempotency_key = private.uuid_from_text('issue_invoice:' || p_order::text);
$$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated;
create temporary table t_sales (name text primary key, id uuid);
insert into t_sales values ('job_failed', pg_temp.pos_sale()), ('job_skipped', pg_temp.pos_sale()), ('sent', pg_temp.pos_sale());
reset role;
select public.prepare_invoice(id) from t_sales;

set local role authenticated;
select is(pg_temp.void((select id from t_sales where name = 'job_failed')) ->> 'error', 'invoice_in_progress',
  'void: waits while the invoice job is still queued');
reset role;

-- The job failed for good (for example, Factus misconfigured): the invoice
-- stays pending, and the sale can be voided anyway.
select pg_temp.end_invoice_job((select id from t_sales where name = 'job_failed'), 'failed');
set local role authenticated;
create temporary table t_v1 as select pg_temp.void((select id from t_sales where name = 'job_failed')) as r;
reset role;
select is((select r ->> 'ok' from t_v1), 'true', 'void: a pending invoice whose job failed no longer blocks it');
select is((select r ->> 'credit_note_id' from t_v1), null, 'void: no credit note for an invoice never accepted');
select is(
  (select status::text from public.orders where id = (select id from t_sales where name = 'job_failed')),
  'refunded', 'void: the sale is refunded'
);
select throws_ok(
  format($$select public.prepare_invoice(%L)$$, (select id from t_sales where name = 'job_failed')),
  '22023', 'invoice_order_not_invoiceable', 'void: that invoice can never be sent afterwards'
);

select pg_temp.end_invoice_job((select id from t_sales where name = 'job_skipped'), 'succeeded');
set local role authenticated;
select is(pg_temp.void((select id from t_sales where name = 'job_skipped')) ->> 'ok', 'true',
  'void: a pending invoice whose job ended without sending it does not block');
reset role;

-- Sent to Factus: the answer may still accept it, so the void waits even if
-- the job is no longer active.
update public.invoices set status = 'sent' where order_id = (select id from t_sales where name = 'sent');
select pg_temp.end_invoice_job((select id from t_sales where name = 'sent'), 'failed');
set local role authenticated;
select is(pg_temp.void((select id from t_sales where name = 'sent')) ->> 'error', 'invoice_in_progress',
  'void: a sent invoice still blocks it');
reset role;

select * from finish();
rollback;
