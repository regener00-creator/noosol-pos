-- Lets an unauthenticated visitor check "does this system already have an
-- owner account?" (needed to decide: show login screen vs owner-setup screen)
-- without exposing the profiles table itself to anon via RLS.
create or replace function public.has_any_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from profiles where owner = true);
$$;

grant execute on function public.has_any_owner() to anon, authenticated;
