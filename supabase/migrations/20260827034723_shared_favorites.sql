-- Make favorites a single store-wide ordered list shared by every signed-in
-- account. Keep user_id as the last editor for traceability.

-- Prefer an owner account's selection if the same product was favorited by
-- multiple accounts before this migration. No product row is deleted.
with ranked as (
  select
    favorite.user_id,
    favorite.product_id,
    row_number() over (
      partition by favorite.product_id
      order by
        case when coalesce(profile.owner,false) or profile.level=1 then 0 else 1 end,
        favorite.position,
        favorite.created_at,
        favorite.user_id
    ) as duplicate_rank
  from public.favorites favorite
  left join public.profiles profile on profile.id=favorite.user_id
)
delete from public.favorites favorite
using ranked
where ranked.user_id=favorite.user_id
  and ranked.product_id=favorite.product_id
  and ranked.duplicate_rank>1;

-- Rebuild one deterministic display order after combining former user lists.
with ranked as (
  select
    favorite.product_id,
    row_number() over (
      order by
        case when coalesce(profile.owner,false) or profile.level=1 then 0 else 1 end,
        favorite.position,
        favorite.created_at,
        favorite.product_id
    )-1 as shared_position
  from public.favorites favorite
  left join public.profiles profile on profile.id=favorite.user_id
)
update public.favorites favorite
set position=ranked.shared_position
from ranked
where ranked.product_id=favorite.product_id;

alter table public.favorites
  drop constraint if exists favorites_pkey;

alter table public.favorites
  add constraint favorites_pkey primary key (product_id);

alter table public.favorites enable row level security;
revoke all on public.favorites from anon,authenticated;
grant select,insert,update,delete on public.favorites to authenticated;

drop policy if exists authenticated_full_access on public.favorites;
drop policy if exists favorites_own_rows on public.favorites;
drop policy if exists favorites_shared_rows on public.favorites;

create policy favorites_shared_rows on public.favorites
for all to authenticated
using (true)
with check ((select auth.uid())=user_id);
