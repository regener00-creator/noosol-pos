-- Allocate customer/supplier codes centrally; retain all existing codes.
-- The partial unique index also protects explicit/imported codes.
create sequence if not exists private.contact_code_sequence as bigint;
revoke all on sequence private.contact_code_sequence from public, anon, authenticated;

select setval('private.contact_code_sequence',
  greatest(coalesce((select max(substring(upper(btrim(data->>'code')) from 2)::bigint)
    from public.contacts where upper(btrim(data->>'code')) ~ '^C[0-9]{1,15}$'),0)+1,1),
  false);

create unique index contacts_code_unique
on public.contacts (upper(btrim(data->>'code')))
where nullif(btrim(data->>'code'),'') is not null;

create or replace function private.assign_contact_code()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_code text; v_number text;
begin
  v_code := btrim(coalesce(new.data->>'code',''));
  if v_code='' or (tg_op='INSERT' and new.data->>'_autoCode'='true') then
    loop
      v_number := nextval('private.contact_code_sequence')::text;
      v_code := 'C'||lpad(v_number,greatest(4,length(v_number)),'0');
      exit when not exists (select 1 from public.contacts where upper(btrim(data->>'code'))=upper(v_code));
    end loop;
  end if;
  new.data := jsonb_set(coalesce(new.data,'{}'::jsonb)-'_autoCode','{code}',to_jsonb(v_code),true);
  return new;
end;
$$;
revoke all on function private.assign_contact_code() from public, anon, authenticated;
create trigger aa_assign_contact_code before insert or update of data on public.contacts
for each row execute function private.assign_contact_code();
notify pgrst, 'reload schema';
