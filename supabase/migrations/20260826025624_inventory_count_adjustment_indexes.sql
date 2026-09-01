-- Cover the optional selected LOT foreign key so long-running adjustment
-- history does not slow down LOT lookups or retention checks.
create index if not exists idx_inventory_count_adjustment_lines_selected_lot
on public.inventory_count_adjustment_lines(selected_lot_id)
where selected_lot_id is not null;
