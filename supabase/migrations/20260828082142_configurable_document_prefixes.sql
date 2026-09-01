-- Make server-generated stock adjustment and cash-shift numbers use the
-- document prefixes saved from the system settings page.

create or replace function private.configured_document_prefix(
  p_key text,
  p_fallback text
) returns text
language sql stable security invoker set search_path=''
as $$
  select coalesce(
    nullif(
      left(
        regexp_replace(
          upper(coalesce((
            select setting.value->>p_key
            from public.settings setting
            where setting.key='document_prefixes'
          ),'')),
          '[^A-Z0-9]','','g'
        ),
        8
      ),
      ''
    ),
    upper(p_fallback)
  )
$$;

revoke execute on function private.configured_document_prefix(text,text)
from public,anon,authenticated;

-- Keep the existing stock-count implementation intact and replace only the
-- hard-coded SC prefix in its stored function body. This also preserves the
-- current permissions and the shortage-compatible wrapper added later.
do $migration$
declare
  v_definition text;
  v_existing constant text := 'v_document_no := ''SC''||to_char';
  v_replacement constant text := 'v_document_no := private.configured_document_prefix(''stockAdjustment'',''SC'')||to_char';
begin
  select pg_get_functiondef(
    'public.post_inventory_count_adjustment(bigint,text,text,text,jsonb)'::regprocedure
  ) into v_definition;

  if strpos(v_definition,v_existing)=0 then
    raise exception 'stock adjustment document prefix assignment was not found';
  end if;

  execute replace(v_definition,v_existing,v_replacement);
end;
$migration$;

create or replace function private.next_cash_shift_number(p_date date)
returns text language plpgsql security definer set search_path=''
as $$
declare v_sequence bigint;
begin
  insert into private.cash_shift_sequences(shift_date,last_value) values(p_date,1)
  on conflict (shift_date) do update set last_value=private.cash_shift_sequences.last_value+1
  returning last_value into v_sequence;
  return private.configured_document_prefix('cashShift','CS')||to_char(p_date,'YYYYMMDD')||lpad(v_sequence::text,4,'0');
end;
$$;

revoke execute on function private.next_cash_shift_number(date)
from public,anon,authenticated;

comment on function private.configured_document_prefix(text,text)
is 'Returns a normalized document prefix from settings.document_prefixes with a safe fallback.';
