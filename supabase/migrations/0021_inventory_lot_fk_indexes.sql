-- Cover foreign keys used by warehouse/user filtering and cleanup checks.
create index if not exists idx_inventory_lots_created_by
on public.inventory_lots(created_by);

create index if not exists idx_inventory_lot_movements_warehouse
on public.inventory_lot_movements(warehouse_id);

create index if not exists idx_inventory_lot_movements_created_by
on public.inventory_lot_movements(created_by);
