-- Products keep their active flag in products.data for backward compatibility.
-- Missing data.active means active. This trigger is the final guard for stale
-- browsers and older clients that try to sell a product after it was disabled.
create or replace function private.prevent_inactive_product_sale_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_active boolean;
begin
  if new.product_id is null then
    return new;
  end if;

  select case
    when lower(coalesce(product.data ->> 'active', 'true')) in ('false', '0', 'no', 'off') then false
    else true
  end
  into v_is_active
  from public.products as product
  where product.id = new.product_id;

  if v_is_active is false then
    raise exception 'product % is inactive', new.product_id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_inactive_product_sale_item() from public, anon, authenticated;

drop trigger if exists prevent_inactive_product_sale_item on public.sale_items;
create trigger prevent_inactive_product_sale_item
before insert or update of product_id on public.sale_items
for each row
execute function private.prevent_inactive_product_sale_item();

