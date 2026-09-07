create table if not exists public.password_recovery_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  question text not null check (char_length(question) between 5 and 200),
  answer_salt text not null check (answer_salt ~ '^[0-9a-f]{32}$'),
  answer_hash text not null check (answer_hash ~ '^[0-9a-f]{64}$'),
  answer_iterations integer not null default 310000 check (answer_iterations between 100000 and 1000000),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.password_recovery_challenges enable row level security;
revoke all on table public.password_recovery_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.password_recovery_challenges to service_role;

drop policy if exists password_recovery_challenges_deny_authenticated
  on public.password_recovery_challenges;
create policy password_recovery_challenges_deny_authenticated
on public.password_recovery_challenges for all
to authenticated
using (false)
with check (false);

create or replace function public.record_password_recovery_failure(p_user_id uuid)
returns table(failed_attempts integer, locked_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.password_recovery_challenges as challenge
  set
    failed_attempts = case
      when challenge.locked_until is not null and challenge.locked_until > clock_timestamp() then challenge.failed_attempts
      when challenge.failed_attempts + 1 >= 5 then 0
      else challenge.failed_attempts + 1
    end,
    locked_until = case
      when challenge.locked_until is not null and challenge.locked_until > clock_timestamp() then challenge.locked_until
      when challenge.failed_attempts + 1 >= 5 then clock_timestamp() + interval '15 minutes'
      else null
    end,
    updated_at = clock_timestamp()
  where challenge.user_id = p_user_id
  returning challenge.failed_attempts, challenge.locked_until;
end;
$$;

revoke all on function public.record_password_recovery_failure(uuid) from public, anon, authenticated;
grant execute on function public.record_password_recovery_failure(uuid) to service_role;

comment on table public.password_recovery_challenges is
  'Owner password recovery questions with salted PBKDF2 answer hashes; never exposed through the Data API.';

