-- A count adjustment must be able to preserve a negative pre-count value in
-- its audit trail. Only the new counted stock is constrained to zero or above.
alter table public.inventory_count_adjustment_lines
drop constraint if exists inventory_count_adjustment_lines_system_stock_check;
