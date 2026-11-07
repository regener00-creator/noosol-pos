create table public.combined_catalog_unit_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  unit_name text not null check (length(trim(unit_name))>0),
  primary key (user_id, product_id)
);
create index combined_unit_product_idx on public.combined_catalog_unit_preferences(product_id);
alter table public.combined_catalog_unit_preferences enable row level security;
revoke all on public.combined_catalog_unit_preferences from public,anon,authenticated;
grant select,insert,update on public.combined_catalog_unit_preferences to authenticated;
create policy account_unit_preferences on public.combined_catalog_unit_preferences
for all to authenticated using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()) and exists(select 1 from public.products p where p.id=product_id));
