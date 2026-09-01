-- This function is an internal trigger helper. It must only run through the
-- products INSERT trigger and must not be callable from the public API.
revoke execute on function public.seed_product_inventory_balance() from public;
revoke execute on function public.seed_product_inventory_balance() from anon;
revoke execute on function public.seed_product_inventory_balance() from authenticated;
