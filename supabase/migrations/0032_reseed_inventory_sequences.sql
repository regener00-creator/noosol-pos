-- A previous inventory restore left sequence counters behind existing rows.
-- Align them once so future LOT and movement inserts cannot reuse old IDs.
select setval(
  pg_get_serial_sequence('public.inventory_lots','id'),
  coalesce((select max(id) from public.inventory_lots),1),
  exists(select 1 from public.inventory_lots)
);

select setval(
  pg_get_serial_sequence('public.inventory_lot_movements','id'),
  coalesce((select max(id) from public.inventory_lot_movements),1),
  exists(select 1 from public.inventory_lot_movements)
);

select setval(
  pg_get_serial_sequence('public.inventory_count_adjustment_lines','id'),
  coalesce((select max(id) from public.inventory_count_adjustment_lines),1),
  exists(select 1 from public.inventory_count_adjustment_lines)
);
