set local lock_timeout='5s';
-- The paginated list uses the effective store (including legacy NULLs); the FK uses the raw column.
create index notes_standalone_warehouse_fk_idx on public.notes(standalone_warehouse_id);
