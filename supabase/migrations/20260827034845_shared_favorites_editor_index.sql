-- The shared favorites primary key no longer covers user_id. Keep the foreign
-- key indexed so deleting an Auth user does not require a sequential scan.
create index if not exists idx_favorites_user_id
  on public.favorites (user_id);
