-- Remember the selected selling unit and display order for each user's
-- favorite product. Existing favorites remain valid and use the product's
-- current main unit after this migration.

alter table public.favorites
  add column if not exists unit text not null default '',
  add column if not exists position integer not null default 0;

update public.favorites favorite
set unit=coalesce(nullif(btrim(favorite.unit),''),nullif(btrim(product.unit),''),'ชิ้น')
from public.products product
where product.id=favorite.product_id
  and nullif(btrim(favorite.unit),'') is null;

with ranked as (
  select user_id,product_id,
         row_number() over(partition by user_id order by created_at,product_id)-1 as new_position
  from public.favorites
)
update public.favorites favorite
set position=ranked.new_position
from ranked
where favorite.user_id=ranked.user_id
  and favorite.product_id=ranked.product_id;

alter table public.favorites enable row level security;
revoke all on public.favorites from anon,authenticated;
grant select,insert,update,delete on public.favorites to authenticated;

drop policy if exists authenticated_full_access on public.favorites;
drop policy if exists favorites_own_rows on public.favorites;
create policy favorites_own_rows on public.favorites
for all to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);
