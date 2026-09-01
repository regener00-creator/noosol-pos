-- Cover the auth-user foreign keys used by cascades and ownership checks.
create index if not exists notes_created_by_idx
  on public.notes(created_by);

create index if not exists notes_updated_by_idx
  on public.notes(updated_by)
  where updated_by is not null;
