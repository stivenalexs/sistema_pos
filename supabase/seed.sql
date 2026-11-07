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

-- Initial stock in base units (goods received). Only through movements (D-019).
insert into public.inventory_movements (product_id, movement_type, units, reference, reason) values
  ('00000000-0000-4000-8000-000000000101', 'purchase_in', 120, 'FC-EJEMPLO-001', 'Inventario inicial de ejemplo'),
  ('00000000-0000-4000-8000-000000000102', 'purchase_in', 60,  'FC-EJEMPLO-001', 'Inventario inicial de ejemplo'),
  ('00000000-0000-4000-8000-000000000103', 'purchase_in', 480, 'FC-EJEMPLO-001', 'Inventario inicial de ejemplo'),
  ('00000000-0000-4000-8000-000000000201', 'purchase_in', 18,  'FC-EJEMPLO-002', 'Inventario inicial de ejemplo'),
  ('00000000-0000-4000-8000-000000000202', 'purchase_in', 24,  'FC-EJEMPLO-002', 'Inventario inicial de ejemplo');

update public.products set web_safety_stock = 2, low_stock_threshold = 12
where id = '00000000-0000-4000-8000-000000000101';

-- Tax data (D-042): degrees, category and whether the product is from the FLA.
update public.products set alcohol_degree = 29, tax_category = 'spirits', is_fla = true  where sku = 'NAC-AGU-750';
update public.products set alcohol_degree = 35, tax_category = 'spirits', is_fla = false where sku = 'NAC-RON-750';
update public.products set alcohol_degree = 4.5, tax_category = 'spirits', is_fla = false where sku = 'NAC-CER-330';
update public.products set alcohol_degree = 40, tax_category = 'spirits', is_fla = false where sku = 'IMP-WHI-700';
update public.products set alcohol_degree = 13, tax_category = 'wine', is_fla = false where sku = 'IMP-VIN-750';
