-- Keep products.updated_at reliable so clients can download only rows whose
-- full product payload changed since their cached manifest.

create or replace function private.set_products_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.set_products_updated_at() from public, anon, authenticated;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row
execute function private.set_products_updated_at();
