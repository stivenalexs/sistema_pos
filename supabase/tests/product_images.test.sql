-- Product images (D-047): bucket settings, admin-only writes and the
-- image path following the products RLS. Run with `npm run db:test`.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.products (id, sku, name, origin, units_per_box, allow_retail_by_unit, is_active, image_path) values
  ('f1000000-0000-4000-8000-000000000001', 'IMG-N', 'Img national', 'national', 12, true, true, 'img-n.webp'),
  ('f1000000-0000-4000-8000-000000000002', 'IMG-I', 'Img imported', 'imported', 6, false, true, 'img-i.webp');

create function pg_temp.as_user(p_id text, p_meta text) returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_id || '","role":"authenticated","app_metadata":' || p_meta || '}', true);
$$;

-- Bucket ----------------------------------------------------------------------

select is((select public from storage.buckets where id = 'product-images'), true,
  'bucket: public read');
select is((select file_size_limit from storage.buckets where id = 'product-images'), 2097152::bigint,
  'bucket: 2 MB limit');
select is((select allowed_mime_types from storage.buckets where id = 'product-images'),
  array['image/jpeg', 'image/png', 'image/webp'], 'bucket: only JPG, PNG and WebP');

-- Column format ---------------------------------------------------------------

select throws_ok(
  $$update public.products set image_path = '../secret.svg' where sku = 'IMG-N'$$,
  '23514', null, 'image_path: rejects paths outside the format');
select lives_ok(
  $$update public.products set image_path = 'aguardiente/750-ml.jpg' where sku = 'IMG-N'$$,
  'image_path: accepts a folder and a jpg');

-- Visitor -----------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select results_eq(
  $$select image_path from public.products where sku like 'IMG-%' order by sku$$,
  array['aguardiente/750-ml.jpg'],
  'anon: sees the image path of national products only');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('product-images', 'x.webp')$$,
  '42501', null, 'anon: cannot upload images');
reset role;

-- Retail customer ---------------------------------------------------------------

select pg_temp.as_user('f2000000-0000-4000-8000-000000000001', '{"customer_type":"retail"}');
set local role authenticated;
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('product-images', 'x.webp')$$,
  '42501', null, 'customer: cannot upload images');
select is_empty(
  $$update public.products set image_path = 'x.webp' where sku = 'IMG-N' returning id$$,
  'customer: cannot change image_path');
reset role;

-- Warehouse staff ---------------------------------------------------------------

select pg_temp.as_user('f2000000-0000-4000-8000-000000000002', '{"staff_role":"warehouse"}');
set local role authenticated;
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('product-images', 'x.webp')$$,
  '42501', null, 'warehouse: cannot upload images');
reset role;

-- Administrator -----------------------------------------------------------------

select pg_temp.as_user('f2000000-0000-4000-8000-000000000003', '{"staff_role":"admin"}');
set local role authenticated;
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('product-images', 'img-n.webp')$$,
  'admin: uploads an image');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'product-images' and name = 'img-n.webp'),
  1, 'admin: lists the uploaded image');
reset role;

select * from finish();
rollback;
