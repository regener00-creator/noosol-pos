-- The first atomic checkout on a date must continue after existing references
-- created by the previous client-side counter, not restart at 0001.

create or replace function private.next_sale_reference(
  p_sale_date date,
  p_prefix text
) returns text
language plpgsql security definer set search_path=''
as $$
declare
  v_prefix text:=upper(regexp_replace(coalesce(p_prefix,'RE'),'[^A-Za-z0-9]','','g'));
  v_date_part text:=to_char(p_sale_date,'YYYYMMDD');
  v_seed bigint;
  v_sequence bigint;
begin
  if v_prefix='' then v_prefix:='RE'; end if;
  v_prefix:=left(v_prefix,8);

  select coalesce(max(substring(sale.ref from char_length(v_prefix)+9)::bigint),0)+1
  into v_seed
  from public.sales sale
  where sale.ref ~ ('^'||v_prefix||v_date_part||'[0-9]+$');

  insert into private.sale_document_sequences(sale_date,prefix,last_value)
  values(p_sale_date,v_prefix,v_seed)
  on conflict (sale_date,prefix) do update
    set last_value=private.sale_document_sequences.last_value+1
  returning last_value into v_sequence;
  return v_prefix||v_date_part||lpad(v_sequence::text,4,'0');
end;
$$;

revoke execute on function private.next_sale_reference(date,text) from public,anon,authenticated;
