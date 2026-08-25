-- Keep exhausted Lot history queries fast as the table grows.
create index if not exists idx_inventory_lots_history
on public.inventory_lots(product_id,warehouse_id,received_at desc,id desc)
where quantity_base<=0 or status='exhausted';
