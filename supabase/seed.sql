-- Sample data for LOCAL development only (`npm run db:reset`).
-- Not loaded in staging or production. Names and prices are made up.

insert into public.price_lists (id, name, customer_type, is_default) values
  ('00000000-0000-4000-8000-000000000001', 'Minorista general', 'retail', true),
  ('00000000-0000-4000-8000-000000000002', 'Mayorista general', 'wholesale', true),
  ('00000000-0000-4000-8000-000000000003', 'Mayorista especial A', 'wholesale', false);

insert into public.products
  (id, sku, name, brand, volume_ml, origin, units_per_box,
   allow_retail_by_unit, retail_min_units, wholesale_min_boxes, is_active)
values
  ('00000000-0000-4000-8000-000000000101', 'NAC-AGU-750', 'Aguardiente de ejemplo 750 ml', 'Marca Nacional', 750, 'national', 12, true, 1, 1, true),
  ('00000000-0000-4000-8000-000000000102', 'NAC-RON-750', 'Ron de ejemplo 750 ml', 'Marca Nacional', 750, 'national', 12, true, 1, 2, true),
  ('00000000-0000-4000-8000-000000000103', 'NAC-CER-330', 'Cerveza de ejemplo 330 ml', 'Marca Nacional', 330, 'national', 24, true, 6, 5, true),
  ('00000000-0000-4000-8000-000000000201', 'IMP-WHI-700', 'Whisky importado de ejemplo 700 ml', 'Marca Importada', 700, 'imported', 6, false, 1, 1, true),
  ('00000000-0000-4000-8000-000000000202', 'IMP-VIN-750', 'Vino importado de ejemplo 750 ml', 'Marca Importada', 750, 'imported', 12, false, 1, 2, true),
  ('00000000-0000-4000-8000-000000000301', 'NAC-OLD-375', 'Producto nacional inactivo', 'Marca Nacional', 375, 'national', 24, true, 1, 1, false);

-- Retail list: price per unit. Wholesale lists: price per box.
insert into public.product_prices (price_list_id, product_id, price_cop) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 45000),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 52000),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', 4000),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000101', 480000),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000102', 560000),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000103', 82000),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000201', 1150000),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000202', 960000),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000101', 460000),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000201', 1100000);
