-- Product images in Supabase Storage (D-037, D-047).
--
-- - Bucket "product-images": public read (catalog photos are not sensitive),
--   only JPG, PNG or WebP up to 2 MB.
-- - Only the administrator uploads, replaces or deletes images (policies on
--   storage.objects). The upload screen arrives with the admin panel
--   (plan step 17); until then images are uploaded by the server.
-- - products.image_path stores the object path inside the bucket. It is read
--   with the products row, so the products RLS decides who sees it (an
--   imported product's image path never reaches a retail customer through
--   the API). get_catalog() and its prices are not changed.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

alter table public.products
  add column image_path text
    constraint products_image_path_format
    check (image_path ~ '^[a-z0-9][a-z0-9_/-]{0,150}\.(jpg|jpeg|png|webp)$');

comment on column public.products.image_path is
  'Object path in the product-images bucket (D-047). Null = no photo.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
);

-- Public buckets serve files by URL without a select policy. Listing and
-- upserts go through storage.objects, so only the administrator gets these.
create policy "product images: admin reads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'product-images'
    and (select private.has_staff_role(array['admin']))
  );

create policy "product images: admin uploads"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (select private.has_staff_role(array['admin']))
  );

create policy "product images: admin updates"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and (select private.has_staff_role(array['admin']))
  )
  with check (
    bucket_id = 'product-images'
    and (select private.has_staff_role(array['admin']))
  );

create policy "product images: admin deletes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (select private.has_staff_role(array['admin']))
  );
