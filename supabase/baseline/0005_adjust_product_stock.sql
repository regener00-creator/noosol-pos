-- Atomic stock increment/decrement, used by checkout and goods-receipt
-- posting so two simultaneous stock changes to the SAME product (e.g. two
-- cashiers selling the same item at the same moment) can never race each
-- other into an inconsistent value the way a client-side read-modify-write
-- (or the old whole-table debounced sync) could.
create or replace function public.adjust_product_stock(p_id bigint, p_delta numeric)
returns void
language sql
as $$
  update products set stock = coalesce(stock,0) + p_delta where id = p_id;
$$;

grant execute on function public.adjust_product_stock(bigint, numeric) to authenticated;
